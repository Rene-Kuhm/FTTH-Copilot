/**
 * Presupuesto de llamadas del cliente SmartOLT (S3).
 *
 * La API de octubre 2026 da 1.000 llamadas por hora y 15 por segundo, y
 * responde 429 con `Retry-After` cuando se pasa. Estas pruebas fijan esa
 * política: el presupuesto configurable, el guardia por segundo, el 429
 * respetado (con espera acotada) y el error tipado que lleva el motivo.
 */
import { describe, expect, it, vi } from 'vitest';
import { isRateLimitError } from '@ftth-copilot/connectors-core';
import { SmartOltClient, SMARTOLT_RATE_LIMIT_PER_HOUR } from '../src/client';
import {
  SMARTOLT_DEFAULT_RATE_LIMIT,
  SmartoltRateGovernor,
  readRetryAfterSeconds,
  resolveSmartoltRateLimitConfig,
} from '../src/rate-limit';
import { SmartoltRateLimitError } from '../src/errors';

const API_BASE = 'https://demo.smartolt.com';
const API_KEY = 'sk-secret-token-1234';

/** Un reloj que no duerme: anota la espera y adelanta el tiempo. */
function fakeClock(startMs = 1_000_000): {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  sleeps: number[];
} {
  let current = startMs;
  const sleeps: number[] = [];
  return {
    now: () => current,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      current += ms;
    },
    sleeps,
  };
}

/** Un fetch que devuelve respuestas en orden y anota las URLs pedidas. */
function sequencedFetch(
  responses: Array<{ status: number; body: unknown; headers?: Record<string, string> }>,
): { fetchImpl: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  let index = 0;
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    calls.push(typeof input === 'string' ? input : input.toString());
    const response = responses[Math.min(index, responses.length - 1)];
    index += 1;
    if (!response) throw new Error('sin respuesta mockeada');
    return new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: { 'content-type': 'application/json', ...response.headers },
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const RATE_LIMITED_BODY = {
  status: false,
  response_code: 'rate_limit_exceeded',
  response: 'API rate limit exceeded. Please try again later.',
  violation_type: 'per_hour',
  retry_after: 2,
};

describe('el presupuesto de llamadas de SmartOLT', () => {
  it('arranca en 1.000 por hora y 15 por segundo', () => {
    const config = resolveSmartoltRateLimitConfig({});

    expect(config).toEqual(SMARTOLT_DEFAULT_RATE_LIMIT);
    expect(config.perHour).toBe(1_000);
    expect(config.perSecond).toBe(15);
  });

  it('toma el presupuesto del entorno', () => {
    const config = resolveSmartoltRateLimitConfig({
      SMARTOLT_RATE_LIMIT_PER_HOUR: '5000',
      SMARTOLT_RATE_LIMIT_PER_SECOND: '8',
      SMARTOLT_MAX_RETRY_AFTER_MS: '5000',
      SMARTOLT_RATE_LIMIT_MAX_RETRIES: '0',
    });

    expect(config).toEqual({
      perHour: 5_000,
      perSecond: 8,
      maxRetryAfterMs: 5_000,
      maxRetries: 0,
    });
  });

  it('ignora un presupuesto que no es un entero positivo', () => {
    for (const raw of ['', 'no-es-un-numero', '0', '-3', '1.5']) {
      const config = resolveSmartoltRateLimitConfig({
        SMARTOLT_RATE_LIMIT_PER_HOUR: raw,
        SMARTOLT_RATE_LIMIT_PER_SECOND: raw,
        SMARTOLT_MAX_RETRY_AFTER_MS: raw,
      });
      expect(config.perHour).toBe(SMARTOLT_DEFAULT_RATE_LIMIT.perHour);
      expect(config.perSecond).toBe(SMARTOLT_DEFAULT_RATE_LIMIT.perSecond);
      expect(config.maxRetryAfterMs).toBe(SMARTOLT_DEFAULT_RATE_LIMIT.maxRetryAfterMs);
    }

    // `maxRetries` sí acepta el cero: reintentar cero veces es una decisión
    // válida, no un error de tipeo.
    expect(
      resolveSmartoltRateLimitConfig({ SMARTOLT_RATE_LIMIT_MAX_RETRIES: '0' }).maxRetries,
    ).toBe(0);
    expect(
      resolveSmartoltRateLimitConfig({ SMARTOLT_RATE_LIMIT_MAX_RETRIES: 'no-es-un-numero' })
        .maxRetries,
    ).toBe(SMARTOLT_DEFAULT_RATE_LIMIT.maxRetries);
  });

  it('deja que la opción del cliente gane sobre el entorno', () => {
    const config = resolveSmartoltRateLimitConfig(
      { SMARTOLT_RATE_LIMIT_PER_HOUR: '900' },
      { perHour: 250 },
    );

    expect(config.perHour).toBe(250);
  });

  it('mantiene exportada la constante vieja con el presupuesto nuevo', () => {
    // Los importadores que quedan no se rompen; el 15 de antes era el límite
    // del export completo, no el de la cuenta.
    expect(SMARTOLT_RATE_LIMIT_PER_HOUR).toBe(SMARTOLT_DEFAULT_RATE_LIMIT.perHour);
  });
});

describe('el guardia de llamadas', () => {
  it('no deja pasar más de 15 llamadas por segundo', async () => {
    const clock = fakeClock();
    const governor = new SmartoltRateGovernor(
      { perHour: 1_000, perSecond: 15, maxRetryAfterMs: 30_000, maxRetries: 2 },
      clock,
    );

    for (let i = 0; i < 15; i++) await governor.beforeRequest('/api/system/get_olts');
    expect(clock.sleeps).toEqual([]);

    await governor.beforeRequest('/api/system/get_olts');
    expect(clock.sleeps).toEqual([1_000]);
  });

  it('gasta el presupuesto por hora y falla sin esperar una hora entera', async () => {
    const clock = fakeClock();
    const governor = new SmartoltRateGovernor(
      { perHour: 3, perSecond: 15, maxRetryAfterMs: 30_000, maxRetries: 2 },
      clock,
    );

    for (let i = 0; i < 3; i++) await governor.beforeRequest('/api/system/get_olts');

    const error = await governor.beforeRequest('/api/system/get_olts').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SmartoltRateLimitError);
    expect(isRateLimitError(error)).toBe(true);
    const rateLimitError = error as SmartoltRateLimitError;
    expect(rateLimitError.violationType).toBe('per_hour');
    expect(rateLimitError.retryAfterSeconds).toBe(3_600);
    expect(clock.sleeps).toEqual([]);
  });

  it('espera el reset cuando la espera entra en el tope configurado', async () => {
    const clock = fakeClock();
    const governor = new SmartoltRateGovernor(
      { perHour: 1, perSecond: 15, maxRetryAfterMs: 4_000_000, maxRetries: 2 },
      clock,
    );

    await governor.beforeRequest('/api/system/get_olts');
    await governor.beforeRequest('/api/system/get_olts');

    expect(clock.sleeps).toEqual([3_600_000]);
  });

  it('espera el reset que anuncia el servidor en X-RateLimit-Reset', async () => {
    const clock = fakeClock();
    const governor = new SmartoltRateGovernor(
      { perHour: 1_000, perSecond: 15, maxRetryAfterMs: 60_000, maxRetries: 2 },
      clock,
    );

    governor.observeResponse(
      new Headers({ 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': '30' }),
      '/api/system/get_olts',
    );
    await governor.beforeRequest('/api/system/get_olts');

    expect(clock.sleeps).toEqual([30_000]);
  });

  it('falla en vez de dormir cuando el reset anunciado supera el tope', async () => {
    const clock = fakeClock();
    const governor = new SmartoltRateGovernor(
      { perHour: 1_000, perSecond: 15, maxRetryAfterMs: 30_000, maxRetries: 2 },
      clock,
    );

    governor.observeResponse(
      new Headers({ 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': '3600' }),
      '/api/system/get_olts',
    );

    const error = await governor.beforeRequest('/api/system/get_olts').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SmartoltRateLimitError);
    expect((error as SmartoltRateLimitError).retryAfterSeconds).toBe(3_600);
    expect(clock.sleeps).toEqual([]);
  });
});

describe('el 429 de SmartOLT', () => {
  function newClient(
    fetchImpl: typeof fetch,
    clock: ReturnType<typeof fakeClock>,
    overrides: { perHour?: number; perSecond?: number; maxRetryAfterMs?: number; maxRetries?: number } = {},
  ): SmartOltClient {
    return new SmartOltClient({
      useMock: false,
      apiKey: API_KEY,
      apiBaseUrl: API_BASE,
      fetchImpl,
      rateLimit: overrides,
      now: clock.now,
      sleep: clock.sleep,
    });
  }

  it('espera el Retry-After y reintenta', async () => {
    const clock = fakeClock();
    const { fetchImpl, calls } = sequencedFetch([
      { status: 429, body: RATE_LIMITED_BODY, headers: { 'Retry-After': '2' } },
      { status: 200, body: { status: true, response: [{ id: '1', name: 'OLT' }] } },
    ]);

    const olts = await newClient(fetchImpl, clock).listOlts();

    expect(calls).toHaveLength(2);
    expect(clock.sleeps).toEqual([2_000]);
    expect(olts).toHaveLength(1);
  });

  it('usa el retry_after del cuerpo cuando falta el header', async () => {
    const clock = fakeClock();
    const { fetchImpl } = sequencedFetch([
      { status: 429, body: { ...RATE_LIMITED_BODY, retry_after: 3 } },
      { status: 200, body: { status: true, response: [] } },
    ]);

    await newClient(fetchImpl, clock).listOlts();

    expect(clock.sleeps).toEqual([3_000]);
  });

  it('falla con un error tipado después de los reintentos', async () => {
    const clock = fakeClock();
    const { fetchImpl, calls } = sequencedFetch([
      { status: 429, body: RATE_LIMITED_BODY, headers: { 'Retry-After': '1' } },
    ]);

    const error = await newClient(fetchImpl, clock, { maxRetries: 2 })
      .listOlts()
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SmartoltRateLimitError);
    expect(isRateLimitError(error)).toBe(true);
    const rateLimitError = error as SmartoltRateLimitError;
    expect(rateLimitError.code).toBe('RATE_LIMIT');
    expect(rateLimitError.status).toBe(429);
    expect(rateLimitError.violationType).toBe('per_hour');
    expect(rateLimitError.retryAfterSeconds).toBe(1);
    expect(calls).toHaveLength(3);
    expect(clock.sleeps).toEqual([1_000, 1_000]);
  });

  it('no duerme más allá del tope: falla y deja el retry_after en el error', async () => {
    const clock = fakeClock();
    const { fetchImpl, calls } = sequencedFetch([
      { status: 429, body: { ...RATE_LIMITED_BODY, retry_after: 3_600 }, headers: { 'Retry-After': '3600' } },
    ]);

    const error = await newClient(fetchImpl, clock, { maxRetryAfterMs: 30_000 })
      .listOlts()
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SmartoltRateLimitError);
    expect((error as SmartoltRateLimitError).retryAfterSeconds).toBe(3_600);
    expect(calls).toHaveLength(1);
    expect(clock.sleeps).toEqual([]);
  });

  it('toma el violation_type del cuerpo cuando el proveedor limita un endpoint', async () => {
    const clock = fakeClock();
    const { fetchImpl } = sequencedFetch([
      {
        status: 429,
        body: { status: false, error: 'Rate limit', error_code: 'rate_limit_exceeded', retry_after: 1 },
        headers: { 'Retry-After': '1' },
      },
    ]);

    const error = await newClient(fetchImpl, clock, { maxRetries: 0 })
      .listOlts()
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SmartoltRateLimitError);
    expect((error as SmartoltRateLimitError).violationType).toBeUndefined();
    expect((error as SmartoltRateLimitError).retryAfterSeconds).toBe(1);
  });

  it('nunca deja el X-Token en el error', async () => {
    const clock = fakeClock();
    const { fetchImpl } = sequencedFetch([
      { status: 429, body: RATE_LIMITED_BODY, headers: { 'Retry-After': '1' } },
    ]);

    const error = await newClient(fetchImpl, clock, { maxRetries: 0 })
      .listOnus()
      .catch((e: unknown) => e);

    const text = `${String(error)}\n${(error as Error).stack ?? ''}`;
    expect(text).not.toContain(API_KEY);
    expect(text).toContain('/api/onu/get_all_onus_details');
  });

  it('no deja el X-Token en un error HTTP que no es 429', async () => {
    const clock = fakeClock();
    const { fetchImpl } = sequencedFetch([{ status: 500, body: { status: false } }]);

    const error = await newClient(fetchImpl, clock).listOlts().catch((e: unknown) => e);

    expect(String(error)).toContain('500');
    expect(`${String(error)}${(error as Error).stack ?? ''}`).not.toContain(API_KEY);
  });
});

describe('la lectura de Retry-After', () => {
  it('lee los segundos del header', () => {
    expect(readRetryAfterSeconds(new Headers({ 'Retry-After': '7' }))).toBe(7);
  });

  it('devuelve undefined si el header falta o no es un número', () => {
    expect(readRetryAfterSeconds(new Headers())).toBeUndefined();
    expect(readRetryAfterSeconds(new Headers({ 'Retry-After': 'soon' }))).toBeUndefined();
  });
});
