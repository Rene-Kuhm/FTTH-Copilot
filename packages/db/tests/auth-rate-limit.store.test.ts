import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock('../src/client', () => ({
  prisma: {
    authRateLimit: {
      findUnique: mocks.findUnique,
      upsert: mocks.upsert,
    },
  },
}));

import { checkAuthQuota, recordAuthAttempt } from '../src/auth-rate-limit';

const NOW = new Date('2026-08-30T12:00:00.000Z');
const OPTS = { max: 3, windowMs: 15 * 60 * 1000 };

beforeEach(() => {
  mocks.findUnique.mockReset();
  mocks.upsert.mockReset();
});

describe('default store (Prisma-backed)', () => {
  it('checkAuthQuota reads the bucket through the Prisma client', async () => {
    mocks.findUnique.mockResolvedValue({
      count: 5,
      expiresAt: new Date(NOW.getTime() + 60_000),
    });
    const decision = await checkAuthQuota('login:ip:1.2.3.4', OPTS, undefined, NOW);
    expect(decision.allowed).toBe(false);
    expect(mocks.findUnique).toHaveBeenCalledWith({
      where: { key_windowStart: { key: 'login:ip:1.2.3.4', windowStart: expect.any(Date) } },
      select: { count: true, expiresAt: true },
    });
  });

  it('recordAuthAttempt upserts the bucket through the Prisma client', async () => {
    mocks.upsert.mockResolvedValue({ count: 1 });
    const decision = await recordAuthAttempt('login:ip:1.2.3.4', OPTS, undefined, NOW);
    expect(decision.allowed).toBe(true);
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key_windowStart: expect.objectContaining({ key: 'login:ip:1.2.3.4' }) },
        create: expect.objectContaining({ key: 'login:ip:1.2.3.4', count: 1 }),
        update: { count: { increment: 1 } },
        select: { count: true },
      }),
    );
  });
});
