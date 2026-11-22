import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/client';
import {
  authRateLimitKeys,
  releaseAuthQuota,
  reserveAuthQuota,
} from '../src/auth-rate-limit';

const suite = (process.env['DATABASE_URL'] ?? '').startsWith('postgres')
  ? describe
  : describe.skip;

const TEST_PREFIX = 'it-concurrency-';

suite('auth-rate-limit concurrency (PostgreSQL integration)', () => {
  beforeEach(async () => {
    await prisma.authRateLimit.deleteMany({
      where: { key: { startsWith: `login:email:${TEST_PREFIX}` } },
    });
    await prisma.authRateLimit.deleteMany({
      where: { key: { startsWith: 'login:ip:198.51.100.' } },
    });
  });

  afterAll(async () => {
    await prisma.authRateLimit.deleteMany({
      where: { key: { startsWith: `login:email:${TEST_PREFIX}` } },
    });
    await prisma.authRateLimit.deleteMany({
      where: { key: { startsWith: 'login:ip:198.51.100.' } },
    });
    await prisma.$disconnect();
  });

  it('allows at most max=3 out of 20 concurrent attempts across email and IP buckets', async () => {
    const opts = { max: 3, windowMs: 15 * 60 * 1000 };
    const now = new Date();
    const keys = authRateLimitKeys(`${TEST_PREFIX}burst@example.invalid`, '198.51.100.77');

    const decisions = await Promise.all(
      Array.from({ length: 20 }, () => reserveAuthQuota(keys, opts, undefined, now)),
    );

    const allowedCount = decisions.filter((d) => d.allowed).length;
    const deniedDecisions = decisions.filter((d) => !d.allowed);
    expect(allowedCount).toBe(3);
    expect(deniedDecisions).toHaveLength(17);
    for (const d of deniedDecisions) {
      expect(d.retryAfter).toBeGreaterThan(0);
    }
  });

  it('enforces the shared IP limit across concurrent attempts targeting distinct emails', async () => {
    const opts = { max: 3, windowMs: 15 * 60 * 1000 };
    const now = new Date();

    const decisions = await Promise.all(
      Array.from({ length: 20 }, (_, i) => {
        const keys = authRateLimitKeys(`${TEST_PREFIX}user-${i}@example.invalid`, '198.51.100.88');
        return reserveAuthQuota(keys, opts, undefined, now);
      }),
    );

    const allowedCount = decisions.filter((d) => d.allowed).length;
    expect(allowedCount).toBeLessThanOrEqual(3);
  });

  it('refunds a reserved attempt on valid authentication without going below zero', async () => {
    const opts = { max: 3, windowMs: 15 * 60 * 1000 };
    const now = new Date();
    const keys = authRateLimitKeys(`${TEST_PREFIX}refund@example.invalid`, '198.51.100.99');

    const first = await reserveAuthQuota(keys, opts, undefined, now);
    expect(first.allowed).toBe(true);
    await releaseAuthQuota(keys, opts, undefined, first.windowStart, first.counts);
    await releaseAuthQuota(keys, opts, undefined, first.windowStart, first.counts);

    const rows = await prisma.authRateLimit.findMany({
      where: { key: { in: keys }, windowStart: first.windowStart },
    });
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.count).toBe(0);
    }

    // All 3 failure slots remain available after refunding the successful attempt.
    for (let i = 0; i < 3; i += 1) {
      const attempt = await reserveAuthQuota(keys, opts, undefined, now);
      expect(attempt.allowed).toBe(true);
    }
    const over = await reserveAuthQuota(keys, opts, undefined, now);
    expect(over.allowed).toBe(false);
    expect(over.retryAfter).toBeGreaterThan(0);
  });
});
