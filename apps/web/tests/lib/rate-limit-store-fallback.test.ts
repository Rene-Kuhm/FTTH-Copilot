/**
 * Sin `REDIS_URL` el límite sigue funcionando en memoria, pero tiene que
 * avisar: un despliegue multi-réplica que piensa que el límite es global y
 * en realidad es por instancia necesita verlo en los logs.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ warn: vi.fn() }));

vi.mock('@ftth-copilot/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ftth-copilot/shared')>();
  return {
    ...actual,
    createLogger: () => ({ warn: mocks.warn }),
  };
});

import { createRateLimitStore } from '@/lib/rate-limit-store';

function envWith(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

describe('createRateLimitStore — respaldo visible', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('avisa cuando no hay REDIS_URL y el límite queda por instancia', () => {
    const store = createRateLimitStore(envWith({ REDIS_URL: undefined }));

    expect(store.kind).toBe('memory');
    expect(mocks.warn).toHaveBeenCalledWith(
      expect.stringContaining('REDIS_URL'),
      expect.anything(),
    );
  });

  it('no avisa cuando el límite es global', () => {
    const store = createRateLimitStore(
      envWith({ REDIS_URL: 'redis://127.0.0.1:6379' }),
    );

    expect(store.kind).toBe('redis');
    expect(mocks.warn).not.toHaveBeenCalled();
  });
});
