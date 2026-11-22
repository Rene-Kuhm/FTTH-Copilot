/**
 * Los E2E de auth cuentan intentos en la tabla `authRateLimit`, claveada por IP.
 * Sin limpiar, la segunda corrida del día hereda los buckets de la primera y
 * `auth-real.spec.ts` muere con 429. globalSetup debe limpiarlos, pero sólo
 * en el entorno de test: nunca contra una base de producción.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearAuthQuotaBuckets,
  shouldResetRateLimits,
} from '../../e2e/reset-rate-limits';

function envWith(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

describe('shouldResetRateLimits — sólo entorno de test', () => {
  it('activa con el bypass de test y una DATABASE_URL', () => {
    expect(
      shouldResetRateLimits(
        envWith({
          ENABLE_TEST_AUTH_BYPASS: 'true',
          DATABASE_URL: 'postgresql://ftth:ftth@localhost:5432/ftth_test',
        }),
      ),
    ).toBe(true);
  });

  it('no activa sin el bypass de test', () => {
    expect(
      shouldResetRateLimits(
        envWith({
          ENABLE_TEST_AUTH_BYPASS: undefined,
          DATABASE_URL: 'postgresql://ftth:ftth@localhost:5432/ftth_test',
        }),
      ),
    ).toBe(false);
  });

  it('no activa sin DATABASE_URL', () => {
    expect(
      shouldResetRateLimits(
        envWith({ ENABLE_TEST_AUTH_BYPASS: 'true', DATABASE_URL: undefined }),
      ),
    ).toBe(false);
  });
});

describe('clearAuthQuotaBuckets — idempotencia entre corridas', () => {
  const deleteMany = vi.fn();
  const cleaner = { deleteMany };

  beforeEach(() => {
    vi.clearAllMocks();
    deleteMany.mockResolvedValue({ count: 7 });
  });

  it('limpia los buckets y devuelve cuántos borró', async () => {
    const env = envWith({
      ENABLE_TEST_AUTH_BYPASS: 'true',
      DATABASE_URL: 'postgresql://ftth:ftth@localhost:5432/ftth_test',
    });

    const count = await clearAuthQuotaBuckets(cleaner, env);

    expect(deleteMany).toHaveBeenCalledOnce();
    expect(count).toBe(7);
  });

  it('no toca la base fuera del entorno de test', async () => {
    const env = envWith({
      ENABLE_TEST_AUTH_BYPASS: undefined,
      DATABASE_URL: 'postgresql://ftth:ftth@localhost:5432/ftth_copilot',
    });

    const count = await clearAuthQuotaBuckets(cleaner, env);

    expect(deleteMany).not.toHaveBeenCalled();
    expect(count).toBe(0);
  });
});
