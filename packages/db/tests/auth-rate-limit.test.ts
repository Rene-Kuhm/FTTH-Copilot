import { describe, expect, it } from 'vitest';
import {
  authRateLimitKeys,
  checkAuthQuota,
  computeWindowStart,
  extractClientIp,
  recordAuthAttempt,
  releaseAuthQuota,
  reserveAuthQuota,
  type AtomicAuthRateLimitStore,
  type AuthRateLimitStore,
} from '../src/auth-rate-limit';

const NOW = new Date('2026-08-30T12:00:00.000Z');
const WINDOW_MS = 15 * 60 * 1000;
const OPTS = { max: 3, windowMs: WINDOW_MS };

describe('extractClientIp', () => {
  it('returns the first hop of X-Forwarded-For', () => {
    expect(extractClientIp('1.2.3.4, 10.0.0.1, 10.0.0.2')).toBe('1.2.3.4');
    expect(extractClientIp('  1.2.3.4  ')).toBe('1.2.3.4');
  });

  it('returns null for missing/empty header', () => {
    expect(extractClientIp(null)).toBeNull();
    expect(extractClientIp(undefined)).toBeNull();
    expect(extractClientIp('')).toBeNull();
    expect(extractClientIp('  ,  ')).toBeNull();
  });
});

describe('computeWindowStart', () => {
  it('aligns a timestamp to the fixed-window boundary', () => {
    const start = computeWindowStart(NOW, WINDOW_MS);
    expect(start.getTime()).toBe(Math.floor(NOW.getTime() / WINDOW_MS) * WINDOW_MS);
  });
});

describe('authRateLimitKeys', () => {
  it('always includes a normalized email key', () => {
    expect(authRateLimitKeys('  User@Example.COM ', null)).toEqual([
      'login:email:user@example.com',
    ]);
  });

  it('adds an IP key when an IP is present', () => {
    expect(authRateLimitKeys('a@b.c', '1.2.3.4')).toEqual([
      'login:email:a@b.c',
      'login:ip:1.2.3.4',
    ]);
  });

  it('supports explicit login scope and isolates keys under the mfa and oidc scopes', () => {
    expect(authRateLimitKeys('a@b.c', '1.2.3.4', 'login')).toEqual([
      'login:email:a@b.c',
      'login:ip:1.2.3.4',
    ]);
    expect(authRateLimitKeys('  User@Example.COM ', null, 'mfa')).toEqual([
      'mfa:email:user@example.com',
    ]);
    expect(authRateLimitKeys('a@b.c', '1.2.3.4', 'mfa')).toEqual([
      'mfa:email:a@b.c',
      'mfa:ip:1.2.3.4',
    ]);
    expect(authRateLimitKeys('  User@Example.COM ', '1.2.3.4', 'oidc')).toEqual([
      'oidc:email:user@example.com',
      'oidc:ip:1.2.3.4',
    ]);
    expect(authRateLimitKeys(null, '1.2.3.4', 'oidc')).toEqual(['oidc:ip:1.2.3.4']);
    expect(authRateLimitKeys('   ', '1.2.3.4', 'oidc')).toEqual(['oidc:ip:1.2.3.4']);
    expect(authRateLimitKeys('a@b.c', null, 'oidc')).toEqual(['oidc:email:a@b.c']);
    expect(authRateLimitKeys(null, null, 'oidc')).toEqual([]);
  });
});

function fakeStore(initial: Record<string, number>): AuthRateLimitStore {
  const buckets = new Map<string, { count: number; expiresAt: Date }>();
  for (const [key, count] of Object.entries(initial)) {
    buckets.set(key, { count, expiresAt: new Date(NOW.getTime() + WINDOW_MS) });
  }
  return {
    async findCount(key) {
      return buckets.get(key) ?? null;
    },
    async increment(key, _windowStart, expiresAt) {
      const current = buckets.get(key);
      const count = (current?.count ?? 0) + 1;
      buckets.set(key, { count, expiresAt });
      return count;
    },
  };
}

describe('checkAuthQuota', () => {
  it('allows when under the limit', async () => {
    const store = fakeStore({ 'login:ip:1.2.3.4': 2 });
    await expect(
      checkAuthQuota('login:ip:1.2.3.4', OPTS, store, NOW),
    ).resolves.toEqual({ allowed: true, retryAfter: 0 });
  });

  it('blocks at the limit and reports retry-after', async () => {
    const store = fakeStore({ 'login:ip:1.2.3.4': 3 });
    const decision = await checkAuthQuota('login:ip:1.2.3.4', OPTS, store, NOW);
    expect(decision.allowed).toBe(false);
    expect(decision.retryAfter).toBeGreaterThan(0);
  });

  it('treats an expired bucket as empty', async () => {
    const store = fakeStore({ 'login:ip:1.2.3.4': 99 });
    // Force expiry by reading with a now far past the window end.
    const farFuture = new Date(NOW.getTime() + WINDOW_MS + 60_000);
    await expect(
      checkAuthQuota('login:ip:1.2.3.4', OPTS, store, farFuture),
    ).resolves.toEqual({ allowed: true, retryAfter: 0 });
  });
});

describe('recordAuthAttempt', () => {
  it('increments and stays allowed below the limit', async () => {
    const store = fakeStore({});
    const first = await recordAuthAttempt('login:ip:1.2.3.4', OPTS, store, NOW);
    expect(first).toEqual({ allowed: true, retryAfter: 0 });
    const third = await recordAuthAttempt('login:ip:1.2.3.4', OPTS, store, NOW);
    await recordAuthAttempt('login:ip:1.2.3.4', OPTS, store, NOW);
    expect(third).toEqual({ allowed: true, retryAfter: 0 });
  });

  it('reports blocked once the bucket crosses the limit', async () => {
    const store = fakeStore({ 'login:email:a@b.c': 2 });
    const first = await recordAuthAttempt('login:email:a@b.c', OPTS, store, NOW);
    expect(first).toEqual({ allowed: true, retryAfter: 0 }); // count 3
    const over = await recordAuthAttempt('login:email:a@b.c', OPTS, store, NOW);
    expect(over.allowed).toBe(false); // count 4
    expect(over.retryAfter).toBeGreaterThan(0);
  });
});

function fakeAtomicStore(initial: Record<string, number>): AtomicAuthRateLimitStore & {
  counts(windowStart?: Date): Record<string, number>;
} {
  const defaultWindowStart = computeWindowStart(NOW, WINDOW_MS);
  const buckets = new Map<
    string,
    { key: string; windowStartMs: number; count: number; expiresAt: Date }
  >();
  const bucketKey = (key: string, windowStart: Date): string =>
    `${key}\0${windowStart.getTime()}`;

  const keyLocks = new Map<string, Promise<void>>();
  const withBucketLocks = async <T>(keys: string[], windowStart: Date, fn: () => Promise<T>): Promise<T> => {
    const releases: Array<() => void> = [];
    for (const bk of [...new Set(keys)].sort().map((k) => bucketKey(k, windowStart))) {
      const prev = keyLocks.get(bk) ?? Promise.resolve();
      let rel!: () => void;
      keyLocks.set(bk, new Promise<void>((r) => { rel = r; }));
      await prev;
      releases.push(rel);
    }
    try { return await fn(); } finally { releases.reverse().forEach((r) => r()); }
  };

  for (const [key, count] of Object.entries(initial)) {
    buckets.set(bucketKey(key, defaultWindowStart), {
      key,
      windowStartMs: defaultWindowStart.getTime(),
      count,
      expiresAt: new Date(defaultWindowStart.getTime() + WINDOW_MS),
    });
  }
  return {
    async findCount(key, windowStart) {
      const entry = buckets.get(bucketKey(key, windowStart));
      return entry ? { count: entry.count, expiresAt: entry.expiresAt } : null;
    },
    async increment(key, windowStart, expiresAt) {
      const bk = bucketKey(key, windowStart);
      const current = buckets.get(bk);
      const count = (current?.count ?? 0) + 1;
      buckets.set(bk, {
        key,
        windowStartMs: windowStart.getTime(),
        count,
        expiresAt,
      });
      return count;
    },
    async reserve(keys, windowStart, expiresAt, max) {
      return withBucketLocks(keys, windowStart, async () => {
        await Promise.resolve();
        const uniqueKeys = [...new Set(keys)].sort();
        if (uniqueKeys.some((k) => (buckets.get(bucketKey(k, windowStart))?.count ?? 0) >= max)) return [];
        return uniqueKeys.map((key) => {
          const bk = bucketKey(key, windowStart);
          const count = (buckets.get(bk)?.count ?? 0) + 1;
          buckets.set(bk, { key, windowStartMs: windowStart.getTime(), count, expiresAt });
          return { key, count };
        });
      });
    },
    async release(keys, windowStart) {
      await withBucketLocks(keys, windowStart, async () => {
        await Promise.resolve();
        for (const key of new Set(keys)) {
          const bk = bucketKey(key, windowStart);
          const cur = buckets.get(bk);
          if (cur) buckets.set(bk, { ...cur, count: Math.max(cur.count - 1, 0) });
        }
      });
    },
    counts(windowStart: Date = defaultWindowStart) {
      const targetMs = windowStart.getTime();
      return Object.fromEntries(
        [...buckets.values()]
          .filter((entry) => entry.windowStartMs === targetMs)
          .map((entry) => [entry.key, entry.count]),
      );
    },
  };
}

describe('reserveAuthQuota & releaseAuthQuota', () => {
  it('allows when all buckets stay within max and returns the windowStart', async () => {
    const store = fakeAtomicStore({ 'login:email:a@b.c': 2, 'login:ip:1.2.3.4': 0 });
    const res = await reserveAuthQuota(['login:email:a@b.c', 'login:ip:1.2.3.4'], OPTS, store, NOW);
    expect(res).toEqual({
      allowed: true,
      retryAfter: 0,
      windowStart: computeWindowStart(NOW, WINDOW_MS),
    });
    expect(store.counts()).toEqual({ 'login:email:a@b.c': 3, 'login:ip:1.2.3.4': 1 });
  });

  it('denies when any bucket exceeds max and reports positive retryAfter', async () => {
    const store = fakeAtomicStore({ 'login:email:a@b.c': 3, 'login:ip:1.2.3.4': 0 });
    const res = await reserveAuthQuota(['login:email:a@b.c', 'login:ip:1.2.3.4'], OPTS, store, NOW);
    expect(res.allowed).toBe(false);
    expect(res.retryAfter).toBeGreaterThan(0);
    expect(res.windowStart).toEqual(computeWindowStart(NOW, WINDOW_MS));
  });

  it('does not increment any bucket when reserving with an already-exhausted key', async () => {
    const store = fakeAtomicStore({});
    const opts = { max: 2, windowMs: WINDOW_MS };
    const attackerKeys = ['login:email:attacker@example.com', 'login:ip:1.2.3.4'];

    expect((await reserveAuthQuota(attackerKeys, opts, store, NOW)).allowed).toBe(true);
    expect((await reserveAuthQuota(attackerKeys, opts, store, NOW)).allowed).toBe(true);
    expect(store.counts()).toEqual({
      'login:email:attacker@example.com': 2,
      'login:ip:1.2.3.4': 2,
    });

    const victimDecision = await reserveAuthQuota(
      ['login:email:victim@example.com', 'login:ip:1.2.3.4'],
      opts,
      store,
      NOW,
    );
    expect(victimDecision.allowed).toBe(false);
    expect(victimDecision.retryAfter).toBeGreaterThan(0);

    const windowStart = computeWindowStart(NOW, WINDOW_MS);
    expect(
      (await store.findCount('login:email:victim@example.com', windowStart))?.count ?? 0,
    ).toBe(0);
    expect(store.counts()).toEqual({
      'login:email:attacker@example.com': 2,
      'login:ip:1.2.3.4': 2,
    });
  });

  it('leaves every bucket untouched when a reservation is denied over the limit', async () => {
    const store = fakeAtomicStore({ 'login:email:other@example.com': 1, 'login:ip:1.2.3.4': OPTS.max });
    const res = await reserveAuthQuota(['login:email:other@example.com', 'login:ip:1.2.3.4'], OPTS, store, NOW);
    expect(res.allowed).toBe(false);
    expect(res.retryAfter).toBeGreaterThan(0);
    expect(store.counts()).toEqual({ 'login:email:other@example.com': 1, 'login:ip:1.2.3.4': OPTS.max });
  });

  it('leaves every bucket unchanged when concurrent reservations include an exhausted key', async () => {
    const store = fakeAtomicStore({ 'login:ip:1.2.3.4': OPTS.max, 'login:email:existing@example.com': 1 });
    const decisions = await Promise.all([
      reserveAuthQuota(['login:email:existing@example.com', 'login:ip:1.2.3.4'], OPTS, store, NOW),
      reserveAuthQuota(['login:email:fresh@example.com', 'login:ip:1.2.3.4'], OPTS, store, NOW),
    ]);
    expect(decisions.every((d) => !d.allowed && d.retryAfter > 0)).toBe(true);
    expect(store.counts()).toEqual({ 'login:ip:1.2.3.4': OPTS.max, 'login:email:existing@example.com': 1 });
  });

  it('refunds partial increments when the store reserves only a subset of requested keys', async () => {
    const store = fakeAtomicStore({ 'login:email:victim@example.com': 1, 'login:ip:1.2.3.4': OPTS.max });
    const partialStore: AtomicAuthRateLimitStore = {
      ...store,
      async reserve(keys, ws, we) {
        return [{ key: keys[0]!, count: await store.increment(keys[0]!, ws, we) }];
      },
    };
    const res = await reserveAuthQuota(['login:email:victim@example.com', 'login:ip:1.2.3.4'], OPTS, partialStore, NOW);
    expect(res).toMatchObject({ allowed: false });
    expect(res.retryAfter).toBeGreaterThan(0);
    expect(store.counts()).toEqual({ 'login:email:victim@example.com': 1, 'login:ip:1.2.3.4': OPTS.max });
  });

  it('leaves every bucket untouched without rollback when a concurrent attempt exhausts a key', async () => {
    const store = fakeAtomicStore({ 'login:ip:1.2.3.4': OPTS.max - 1 });
    const windowEnd = new Date(computeWindowStart(NOW, WINDOW_MS).getTime() + WINDOW_MS);
    let raced = false;
    const racingStore: AtomicAuthRateLimitStore = {
      ...store,
      async reserve(keys, ws, we, max) {
        if (!raced) {
          raced = true;
          await store.increment('login:ip:1.2.3.4', ws, windowEnd);
        }
        return store.reserve(keys, ws, we, max);
      },
    };
    const res = await reserveAuthQuota(['login:email:victim@example.com', 'login:ip:1.2.3.4'], OPTS, racingStore, NOW);
    expect(res.allowed).toBe(false);
    expect(res.retryAfter).toBeGreaterThan(0);
    expect(store.counts()).toEqual({ 'login:ip:1.2.3.4': OPTS.max });
  });

  it('bounds concurrent reservations to max without overcounting buckets', async () => {
    const store = fakeAtomicStore({});
    const sharedIp = 'login:ip:1.2.3.4';
    const decisions = await Promise.all(
      Array.from({ length: 10 }, (_, i) => reserveAuthQuota([`login:email:u${i}@example.com`, sharedIp], OPTS, store, NOW)),
    );
    const allowed = decisions.filter((d) => d.allowed);
    expect(allowed).toHaveLength(OPTS.max);
    expect(decisions.filter((d) => !d.allowed).every((d) => d.retryAfter > 0)).toBe(true);
    const counts = store.counts();
    expect(counts[sharedIp]).toBe(OPTS.max);
    expect(Object.entries(counts).filter(([k]) => k.startsWith('login:email:')).reduce((s, [, v]) => s + v, 0)).toBe(OPTS.max);
  });

  it('allows immediately without touching the store when keys are empty', async () => {
    const store = fakeAtomicStore({});
    const res = await reserveAuthQuota([], OPTS, store, NOW);
    expect(res.allowed).toBe(true);
    expect(res.retryAfter).toBe(0);
    await releaseAuthQuota([], OPTS, store, res.windowStart);
    expect(store.counts()).toEqual({});
  });

  it('refunds reserved buckets and floors at zero', async () => {
    const store = fakeAtomicStore({});
    const keys = ['login:email:a@b.c', 'login:ip:1.2.3.4'];
    const reservation = await reserveAuthQuota(keys, OPTS, store, NOW);
    expect(store.counts()).toEqual({ 'login:email:a@b.c': 1, 'login:ip:1.2.3.4': 1 });

    await releaseAuthQuota(keys, OPTS, store, reservation.windowStart);
    await releaseAuthQuota(keys, OPTS, store, reservation.windowStart);
    expect(store.counts()).toEqual({ 'login:email:a@b.c': 0, 'login:ip:1.2.3.4': 0 });
  });

  it('refunds sequentially and always applies even when another attempt overlaps', async () => {
    const store = fakeAtomicStore({ 'login:email:a@b.c': 1, 'login:ip:1.2.3.4': 1 });
    const keys = ['login:email:a@b.c', 'login:ip:1.2.3.4'];
    const seq = await reserveAuthQuota(keys, OPTS, store, NOW);
    expect(store.counts()).toEqual({ 'login:email:a@b.c': 2, 'login:ip:1.2.3.4': 2 });
    await releaseAuthQuota(keys, OPTS, store, seq.windowStart);
    expect(store.counts()).toEqual({ 'login:email:a@b.c': 1, 'login:ip:1.2.3.4': 1 });

    const raced = await reserveAuthQuota(keys, OPTS, store, NOW);
    await store.increment('login:ip:1.2.3.4', raced.windowStart, new Date(raced.windowStart.getTime() + WINDOW_MS));
    await releaseAuthQuota(keys, OPTS, store, raced.windowStart);
    expect(store.counts()).toEqual({ 'login:email:a@b.c': 1, 'login:ip:1.2.3.4': 2 });
  });

  it('refunds a successful attempt to pre-attempt count even with a concurrent attempt in between', async () => {
    const store = fakeAtomicStore({ 'login:email:a@b.c': 1, 'login:ip:1.2.3.4': 1 });
    const keys = ['login:email:a@b.c', 'login:ip:1.2.3.4'];
    const ok = await reserveAuthQuota(keys, OPTS, store, NOW);
    const [failed] = await Promise.all([reserveAuthQuota(keys, OPTS, store, NOW), releaseAuthQuota(keys, OPTS, store, ok.windowStart)]);
    expect(ok.allowed && failed.allowed).toBe(true);
    expect(store.counts()).toEqual({ 'login:email:a@b.c': 2, 'login:ip:1.2.3.4': 2 });
  });

  it('refunds only window N when clock advances to window N+1 and leaves N+1 untouched', async () => {
    const store = fakeAtomicStore({});
    const keys = ['login:email:a@b.c', 'login:ip:1.2.3.4'];
    const nowN = NOW;
    const nowN1 = new Date(NOW.getTime() + WINDOW_MS);

    const resN = await reserveAuthQuota(keys, OPTS, store, nowN);
    expect(resN.allowed).toBe(true);

    // Clock advances into window N+1; reserve the same keys in the new window.
    const resN1 = await reserveAuthQuota(keys, OPTS, store, nowN1);
    expect(resN1.allowed).toBe(true);

    // Release using windowStart of window N: must refund N to 0 and leave N+1 at 1.
    await releaseAuthQuota(keys, OPTS, store, resN.windowStart);

    for (const key of keys) {
      expect((await store.findCount(key, resN.windowStart))?.count).toBe(0);
      expect((await store.findCount(key, resN1.windowStart))?.count).toBe(1);
    }

    // Window N+1 still has 2 remaining slots out of max=3 (3rd attempt allowed, 4th denied).
    expect((await reserveAuthQuota(keys, OPTS, store, nowN1)).allowed).toBe(true); // count 2
    expect((await reserveAuthQuota(keys, OPTS, store, nowN1)).allowed).toBe(true); // count 3
    expect((await reserveAuthQuota(keys, OPTS, store, nowN1)).allowed).toBe(false); // count 4
  });

  it('treats release for a window with no bucket as a no-op without touching another window', async () => {
    const store = fakeAtomicStore({});
    const keys = ['login:email:a@b.c', 'login:ip:1.2.3.4'];
    const windowN = computeWindowStart(NOW, WINDOW_MS);
    const nowN1 = new Date(NOW.getTime() + WINDOW_MS);

    const resN1 = await reserveAuthQuota(keys, OPTS, store, nowN1);
    expect(resN1.allowed).toBe(true);

    await releaseAuthQuota(keys, OPTS, store, windowN);

    for (const key of keys) {
      expect(await store.findCount(key, windowN)).toBeNull();
      expect((await store.findCount(key, resN1.windowStart))?.count).toBe(1);
    }
  });

  it('isolates findCount and increment across windowStart boundaries', async () => {
    const store = fakeAtomicStore({});
    const key = 'login:email:a@b.c';
    const nowN = NOW;
    const nowN1 = new Date(NOW.getTime() + WINDOW_MS);
    const windowN = computeWindowStart(nowN, WINDOW_MS);
    const windowN1 = computeWindowStart(nowN1, WINDOW_MS);

    for (let i = 0; i < OPTS.max; i += 1) {
      expect((await recordAuthAttempt(key, OPTS, store, nowN)).allowed).toBe(true);
    }
    expect((await store.findCount(key, windowN))?.count).toBe(3);
    expect(await store.findCount(key, windowN1)).toBeNull();
    expect((await checkAuthQuota(key, OPTS, store, nowN)).allowed).toBe(false);
    expect((await checkAuthQuota(key, OPTS, store, nowN1)).allowed).toBe(true);

    expect((await recordAuthAttempt(key, OPTS, store, nowN1)).allowed).toBe(true);
    expect((await store.findCount(key, windowN))?.count).toBe(3);
    expect((await store.findCount(key, windowN1))?.count).toBe(1);
  });
});
