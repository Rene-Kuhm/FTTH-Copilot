import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/client';
import {
  authRateLimitKeys,
  computeWindowStart,
  releaseAuthQuota,
  reserveAuthQuota,
} from '../src/auth-rate-limit';

const suite = (process.env['DATABASE_URL'] ?? '').startsWith('postgres')
  ? describe
  : describe.skip;

const TEST_PREFIX = 'it-window-';
const TEST_IP_PREFIX = 'login:ip:203.0.113.';

suite('auth-rate-limit window isolation (PostgreSQL integration)', () => {
  beforeEach(async () => {
    await prisma.authRateLimit.deleteMany({
      where: { key: { startsWith: `login:email:${TEST_PREFIX}` } },
    });
    await prisma.authRateLimit.deleteMany({
      where: { key: { startsWith: TEST_IP_PREFIX } },
    });
  });

  afterAll(async () => {
    await prisma.authRateLimit.deleteMany({
      where: { key: { startsWith: `login:email:${TEST_PREFIX}` } },
    });
    await prisma.authRateLimit.deleteMany({
      where: { key: { startsWith: TEST_IP_PREFIX } },
    });
    await prisma.$disconnect();
  });

  it('refunds only window N when clock advances to window N+1 and leaves N+1 untouched', async () => {
    const opts = { max: 3, windowMs: 15 * 60 * 1000 };
    const nowN = new Date('2026-08-30T12:00:00.000Z');
    const nowN1 = new Date(nowN.getTime() + opts.windowMs);
    const keys = authRateLimitKeys(`${TEST_PREFIX}boundary@example.invalid`, '203.0.113.10');

    const resN = await reserveAuthQuota(keys, opts, undefined, nowN);
    expect(resN.allowed).toBe(true);

    const resN1 = await reserveAuthQuota(keys, opts, undefined, nowN1);
    expect(resN1.allowed).toBe(true);

    // Refund window N after N+1 has already started.
    await releaseAuthQuota(keys, opts, undefined, resN.windowStart, resN.counts);

    const rowsN = await prisma.authRateLimit.findMany({
      where: { key: { in: keys }, windowStart: resN.windowStart },
    });
    expect(rowsN).toHaveLength(2);
    for (const row of rowsN) {
      expect(row.count).toBe(0);
    }

    const rowsN1 = await prisma.authRateLimit.findMany({
      where: { key: { in: keys }, windowStart: resN1.windowStart },
    });
    expect(rowsN1).toHaveLength(2);
    for (const row of rowsN1) {
      expect(row.count).toBe(1);
    }

    // Window N+1 keeps its 1 used slot and allows only 2 more attempts under max=3.
    expect((await reserveAuthQuota(keys, opts, undefined, nowN1)).allowed).toBe(true);
    expect((await reserveAuthQuota(keys, opts, undefined, nowN1)).allowed).toBe(true);
    const overN1 = await reserveAuthQuota(keys, opts, undefined, nowN1);
    expect(overN1.allowed).toBe(false);
    expect(overN1.retryAfter).toBeGreaterThan(0);
  });

  it('treats release for a window with no bucket as a no-op without touching another window', async () => {
    const opts = { max: 3, windowMs: 15 * 60 * 1000 };
    const nowN = new Date('2026-08-30T12:00:00.000Z');
    const windowN = computeWindowStart(nowN, opts.windowMs);
    const nowN1 = new Date(nowN.getTime() + opts.windowMs);
    const keys = authRateLimitKeys(`${TEST_PREFIX}noop@example.invalid`, '203.0.113.11');

    const resN1 = await reserveAuthQuota(keys, opts, undefined, nowN1);
    expect(resN1.allowed).toBe(true);

    await releaseAuthQuota(keys, opts, undefined, windowN);

    const rowsN = await prisma.authRateLimit.findMany({
      where: { key: { in: keys }, windowStart: windowN },
    });
    expect(rowsN).toHaveLength(0);

    const rowsN1 = await prisma.authRateLimit.findMany({
      where: { key: { in: keys }, windowStart: resN1.windowStart },
    });
    expect(rowsN1).toHaveLength(2);
    for (const row of rowsN1) {
      expect(row.count).toBe(1);
    }
  });
});
