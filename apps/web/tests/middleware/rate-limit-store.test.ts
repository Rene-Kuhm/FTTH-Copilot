/**
 * El límite del middleware de Edge (`middleware/rate-limit.ts`) es en memoria
 * y por instancia: nunca debe tocar `lib/rate-limit-store.ts` (que importa
 * `ioredis` y rompe en Edge). El store compartido queda para los route handlers
 * que corren en Node.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getRateLimitStore: vi.fn(() => {
    throw new Error(
      'middleware/rate-limit.ts no debe usar el store compartido (@/lib/rate-limit-store)',
    );
  }),
}));

vi.mock('@/lib/rate-limit-store', () => ({
  getRateLimitStore: mocks.getRateLimitStore,
}));

import { checkRateLimit } from '../../middleware/rate-limit';

describe('checkRateLimit — limitador en memoria del middleware Edge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('nunca consulta el store compartido de Redis (@/lib/rate-limit-store)', async () => {
    const result = await checkRateLimit('rl:ip:203.0.113.7', {
      max: 10,
      windowMs: 60_000,
      keyPrefix: 'rl',
    });

    expect(mocks.getRateLimitStore).not.toHaveBeenCalled();
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(9);
  });

  it('mantiene un contador stateful en memoria: con max=1, la segunda llamada al mismo key es denegada', async () => {
    const config = { max: 1, windowMs: 60_000, keyPrefix: 'rl' };
    const key = 'rl:ip:203.0.113.42';

    const first = await checkRateLimit(key, config);
    const second = await checkRateLimit(key, config);

    expect(mocks.getRateLimitStore).not.toHaveBeenCalled();
    expect(first.allowed).toBe(true);
    expect(first.remaining).toBe(0);
    expect(second.allowed).toBe(false);
    expect(second.remaining).toBe(0);
  });
});
