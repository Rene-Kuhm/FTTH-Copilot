import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  WORKER_HEALTH_KEY,
  WORKER_HEALTH_TTL_SECONDS,
  parseWorkerHealthSnapshot,
  type ServiceHealth,
} from '@ftth-copilot/scheduler';
import { createHealthPublisher, startHealthPublisher } from '../src/health-publisher';

const { logMock } = vi.hoisted(() => ({
  logMock: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@ftth-copilot/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ftth-copilot/shared')>();
  return { ...actual, createLogger: () => logMock };
});

/**
 * The worker publishes the state of its loops.
 *
 * The web cannot read the registry from the memory of the worker: the
 * process that runs the loops is not the process that serves the health
 * endpoint. The snapshot travels through Redis, and this suite pins what the
 * worker puts there.
 */
/** A loop that ticked, as the registry describes it. */
const polling: ServiceHealth = {
  expected: true,
  lastRunAt: 1_700_000_000_000,
  lastError: null,
  lastErrorAt: null,
};

/** A Redis client that records what it was asked to write. */
function recordingClient(): {
  client: { set: (key: string, value: string, mode: 'EX', ttl: number) => Promise<unknown> };
  writes: Array<{ key: string; value: string; mode: string; ttl: number }>;
} {
  const writes: Array<{ key: string; value: string; mode: string; ttl: number }> = [];
  return {
    writes,
    client: {
      set: async (key, value, mode, ttl) => {
        writes.push({ key, value, mode, ttl });
        return 'OK';
      },
    },
  };
}

describe('worker health publisher', () => {
  afterEach(() => {
    vi.useRealTimers();
    logMock.warn.mockClear();
  });

  it('writes the snapshot under the key of the contract', async () => {
    const { client, writes } = recordingClient();
    const publisher = createHealthPublisher({ client, services: () => ({ polling }) });

    expect(await publisher.publish()).toBe(true);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.key).toBe(WORKER_HEALTH_KEY);
  });

  it('writes it with an expiry so a dead worker leaves no green trace', async () => {
    const { client, writes } = recordingClient();
    const publisher = createHealthPublisher({ client, services: () => ({ polling }) });

    await publisher.publish();
    expect(writes[0]?.mode).toBe('EX');
    expect(writes[0]?.ttl).toBe(WORKER_HEALTH_TTL_SECONDS);
  });

  it('publishes the state of the loops', async () => {
    const { client, writes } = recordingClient();
    const publisher = createHealthPublisher({ client, services: () => ({ polling }) });

    await publisher.publish();
    const parsed = parseWorkerHealthSnapshot(writes[0]?.value ?? null);
    expect(parsed?.services['polling']).toEqual(polling);
  });

  it('publishes the counters of the ingest path of the worker', async () => {
    const { client, writes } = recordingClient();
    const publisher = createHealthPublisher({
      client,
      services: () => ({ polling }),
      counters: () => ({ backlog: 7, dropped: 0 }),
    });

    await publisher.publish();
    const parsed = parseWorkerHealthSnapshot(writes[0]?.value ?? null);
    expect(parsed?.counters).toEqual({ backlog: 7, dropped: 0 });
  });

  it('reports a failure instead of throwing when Redis is unreachable', async () => {
    const client = {
      set: async (): Promise<unknown> => {
        throw new Error('ECONNREFUSED');
      },
    };
    const publisher = createHealthPublisher({ client, services: () => ({ polling }) });

    expect(await publisher.publish()).toBe(false);
    expect(logMock.warn).toHaveBeenCalledTimes(1);
  });

  it('does not repeat the same failure on every tick', async () => {
    let clock = 0;
    const client = {
      set: async (): Promise<unknown> => {
        throw new Error('ECONNREFUSED');
      },
    };
    const publisher = createHealthPublisher({
      client,
      services: () => ({ polling }),
      now: () => clock,
    });

    expect(await publisher.publish()).toBe(false);
    clock = 1_000;
    expect(await publisher.publish()).toBe(false);
    expect(logMock.warn).toHaveBeenCalledTimes(1);

    // The outage goes on: the log repeats it once a minute, not once a tick.
    clock = 120_000;
    expect(await publisher.publish()).toBe(false);
    expect(logMock.warn).toHaveBeenCalledTimes(2);
  });

  it('keeps publishing on its own until it is stopped', async () => {
    vi.useFakeTimers();
    const { client, writes } = recordingClient();
    const handle = startHealthPublisher({
      client,
      services: () => ({ polling }),
      intervalMs: 20_000,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(writes).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(20_000);
    expect(writes).toHaveLength(2);

    handle.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(writes).toHaveLength(2);
  });
});

describe('the connection of the publisher', () => {
  it('does not write before the connection is ready', async () => {
    const { client, writes } = recordingClient();
    const publisher = createHealthPublisher({
      client: { ...client, isReady: () => false },
      services: () => ({ polling }),
    });

    // The client refuses commands while it has no connection: the tick is
    // skipped and the next one writes. Losing the first publication is
    // better than a log full of connection errors.
    expect(await publisher.publish()).toBe(false);
    expect(writes).toHaveLength(0);
  });

  it('writes once the connection is ready', async () => {
    const { client, writes } = recordingClient();
    const publisher = createHealthPublisher({
      client: { ...client, isReady: () => true },
      services: () => ({ polling }),
    });

    expect(await publisher.publish()).toBe(true);
    expect(writes).toHaveLength(1);
  });
});
