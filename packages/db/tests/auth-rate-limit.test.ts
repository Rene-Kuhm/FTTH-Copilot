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
  counts(): Record<string, number>;
} {
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
    async reserve(keys, _windowStart, expiresAt) {
      return keys.map((key) => {
        const current = buckets.get(key);
        const count = (current?.count ?? 0) + 1;
        buckets.set(key, { count, expiresAt });
        return count;
      });
    },
    async release(keys) {
      for (const key of keys) {
        const current = buckets.get(key);
        if (current) {
          buckets.set(key, { count: Math.max(current.count - 1, 0), expiresAt: current.expiresAt });
        }
      }
    },
    counts() {
      return Object.fromEntries([...buckets.entries()].map(([k, v]) => [k, v.count]));
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
});
