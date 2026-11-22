/**
 * El límite del proxy tiene que contar en el store global compartido, no en un
 * Map del proceso. Con `REDIS_URL` el límite es de todas las réplicas; sin
 * ella el mismo store cae a memoria y sigue funcionando por instancia.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RateLimitResult } from '../../lib/rate-limit-core';

const mocks = vi.hoisted(() => ({
  consume: vi.fn(),
  getRateLimitStore: vi.fn(),
}));

vi.mock('@/lib/rate-limit-store', () => ({
  getRateLimitStore: mocks.getRateLimitStore,
}));

import { checkRateLimit } from '../../middleware/rate-limit';

const CONFIG = { max: 10, windowMs: 60_000, keyPrefix: 'rl' };

describe('checkRateLimit — store global compartido', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRateLimitStore.mockReturnValue({ kind: 'redis', consume: mocks.consume });
  });

  it('consume el store compartido en vez de un contador por instancia', async () => {
    const expected: RateLimitResult = { allowed: true, remaining: 9, resetAt: 1_000 };
    mocks.consume.mockResolvedValue(expected);

    const actual = await checkRateLimit('rl:ip:203.0.113.7', CONFIG);

    expect(mocks.getRateLimitStore).toHaveBeenCalledOnce();
    expect(mocks.consume).toHaveBeenCalledWith(
      'rl:ip:203.0.113.7',
      CONFIG,
      expect.any(Number),
    );
    expect(actual).toEqual(expected);
  });

  it('respeta un resultado de cuota agotada del store compartido', async () => {
    mocks.consume.mockResolvedValue({ allowed: false, remaining: 0, resetAt: 1_000 });

    const actual = await checkRateLimit('rl:ip:203.0.113.7', CONFIG);

    expect(actual.allowed).toBe(false);
  });
});
