import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Distributed lock for the scheduler loops.
 *
 * The loops were guarded only in-process, so with more than one app instance
 * every instance polled the NMS and wrote the same samples. This asserts the
 * property that matters: across instances, only one holds a given lock.
 *
 * The lock is transaction-scoped rather than session-scoped because Prisma
 * pools connections: a session-level pg_advisory_lock would stay held on a
 * connection returned to the pool and would never be released.
 */

const mocks = vi.hoisted(() => ({ queryRaw: vi.fn(), transaction: vi.fn() }));

vi.mock('@ftth-copilot/db', () => ({
  prisma: {
    $transaction: mocks.transaction,
    nmsConnection: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

const { acquireSchedulerLock, advisoryLockKey } = await import(
  '@/lib/monitoring/scheduler'
);

/**
 * Prisma receives the TemplateStringsArray itself as the first argument and
 * the interpolated values as the rest, so the SQL is args[0].join(' ') and the
 * first parameter is args[1].
 */
function sqlOf(call: unknown): string {
  return ((call as [readonly string[]])[0]).join(' ');
}

function paramOf(call: unknown): unknown {
  return (call as [readonly string[], unknown])[1];
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
    fn({ $queryRaw: mocks.queryRaw }),
  );
});

describe('advisoryLockKey', () => {
  it('is stable for the same loop name, which is what every instance relies on', () => {
    expect(advisoryLockKey('polling')).toBe(advisoryLockKey('polling'));
    expect(advisoryLockKey('firmware')).toBe(advisoryLockKey('firmware'));
  });

  it('gives different loops different keys', () => {
    expect(advisoryLockKey('polling')).not.toBe(advisoryLockKey('firmware'));
    expect(advisoryLockKey('fec')).not.toBe(advisoryLockKey('polling'));
  });

  it('stays inside the signed 63-bit range Postgres accepts', () => {
    for (const name of ['polling', 'firmware', 'fec', 'syslog', '']) {
      const key = advisoryLockKey(name);
      expect(key).toBeGreaterThanOrEqual(0n);
      expect(key).toBeLessThan(2n ** 63n);
    }
  });

  it('handles an empty name without colliding with real ones', () => {
    expect(advisoryLockKey('')).not.toBe(advisoryLockKey('polling'));
  });
});

describe('acquireSchedulerLock', () => {
  it('uses a transaction-scoped lock', async () => {
    mocks.queryRaw.mockResolvedValue([{ locked: true }]);

    await acquireSchedulerLock('polling');

    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    // pg_advisory_lock (session) would leak on a pooled connection.
    expect(sqlOf(mocks.queryRaw.mock.calls[0])).toContain(
      'pg_try_advisory_xact_lock',
    );
  });

  it('passes the derived key as a bigint cast', async () => {
    mocks.queryRaw.mockResolvedValue([{ locked: true }]);

    await acquireSchedulerLock('polling');

    expect(sqlOf(mocks.queryRaw.mock.calls[0])).toContain('::bigint');
    expect(paramOf(mocks.queryRaw.mock.calls[0])).toBe(
      advisoryLockKey('polling').toString(),
    );
  });

  it('reports granted when the database grants the lock', async () => {
    mocks.queryRaw.mockResolvedValue([{ locked: true }]);

    expect(await acquireSchedulerLock('polling')).toBe(true);
  });

  it('reports denied when another instance holds it', async () => {
    // pg_try_advisory_xact_lock returns false rather than blocking, which is
    // what keeps a losing instance from piling up behind the holder.
    mocks.queryRaw.mockResolvedValue([{ locked: false }]);

    expect(await acquireSchedulerLock('polling')).toBe(false);
  });

  it('denies by default when the query returns nothing', async () => {
    mocks.queryRaw.mockResolvedValue([]);

    expect(await acquireSchedulerLock('polling')).toBe(false);
  });

  it('proceeds when the database is unreachable', async () => {
    // Staying silent would leave /api/health green while nothing runs, so an
    // unreachable database degrades to the old in-process behaviour and the
    // failure surfaces through the scheduler health registry instead.
    mocks.transaction.mockRejectedValue(new Error('Database connection refused'));

    expect(await acquireSchedulerLock('polling')).toBe(true);
  });
});

describe('two instances', () => {
  it('lets only one of them run the same loop', async () => {
    // Model the database behaviour: the first caller holds the lock, the
    // second is refused.
    let holder: string | null = null;
    const lockDb = (instance: string) => ({
      $queryRaw: vi.fn(async () => {
        if (holder === null) {
          holder = instance;
          return [{ locked: true }];
        }
        return [{ locked: holder === instance }];
      }),
    });

    mocks.transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn(lockDb('instance-a')),
    );
    const instanceA = await acquireSchedulerLock('polling');

    mocks.transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn(lockDb('instance-b')),
    );
    const instanceB = await acquireSchedulerLock('polling');

    expect(instanceA).toBe(true);
    expect(instanceB).toBe(false);
  });

  it('does not let one loop holding a lock block another loop', async () => {
    // Otherwise losing the polling race would also silence the firmware audit.
    let held: string | null = 'polling';
    mocks.transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn({
        $queryRaw: vi.fn(async () => [{ locked: held !== 'firmware' }]),
      }),
    );

    expect(await acquireSchedulerLock('firmware')).toBe(true);
    expect(held).toBe('polling');
  });
});