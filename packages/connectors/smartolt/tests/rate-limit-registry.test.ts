/**
 * Presupuesto por cuenta (S3).
 *
 * El presupuesto de 1.000 llamadas por hora es de la cuenta, no de la
 * instancia del cliente. El scheduler construye un cliente nuevo en cada
 * poll, así que un guardia por instancia reiniciaba el contador cada vez y el
 * conector podía pasarse del límite sin enterarse. Estas pruebas fijan el
 * registro que comparte el guardia por cuenta, con la clave derivada de la
 * URL base y un hash de la API key: la key cruda nunca es parte de la clave.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SmartOltClient } from '../src/client';
import { SmartoltRateLimitError } from '../src/errors';
import {
  __resetSmartoltAccountBudgetsForTests,
  getAccountHourlyBudget,
  getAccountRateGovernor,
  smartoltAccountKey,
} from '../src/rate-limit-registry';
import { SMARTOLT_DEFAULT_RATE_LIMIT } from '../src/rate-limit';

const API_BASE = 'https://demo.smartolt.com';
const API_KEY = 'sk-secret-token-1234';

function fakeClock(startMs = 1_000_000): {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
} {
  let current = startMs;
  return {
    now: () => current,
    sleep: async (ms: number) => {
      current += ms;
    },
  };
}

function oltsFetch(): typeof fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify({ status: true, response: [{ id: '1', name: 'OLT-A' }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  ) as unknown as typeof fetch;
}

beforeEach(() => {
  __resetSmartoltAccountBudgetsForTests();
});

describe('la clave de cuenta', () => {
  it('es estable para la misma cuenta', () => {
    expect(smartoltAccountKey({ apiBaseUrl: API_BASE, apiKey: API_KEY })).toBe(
      smartoltAccountKey({ apiBaseUrl: API_BASE, apiKey: API_KEY }),
    );
  });

  it('cambia con la URL base y con la API key', () => {
    const base = smartoltAccountKey({ apiBaseUrl: API_BASE, apiKey: API_KEY });
    const otherBase = smartoltAccountKey({
      apiBaseUrl: 'https://otro.smartolt.com',
      apiKey: API_KEY,
    });
    const otherKey = smartoltAccountKey({ apiBaseUrl: API_BASE, apiKey: 'sk-otra' });

    expect(new Set([base, otherBase, otherKey]).size).toBe(3);
  });

  it('nunca lleva la API key cruda', () => {
    const key = smartoltAccountKey({ apiBaseUrl: API_BASE, apiKey: API_KEY });

    expect(key).not.toContain(API_KEY);
    expect(key).toContain('demo.smartolt.com');
    expect(key).toMatch(/#[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
  });

  it('normaliza la barra final de la URL base', () => {
    expect(smartoltAccountKey({ apiBaseUrl: `${API_BASE}/`, apiKey: API_KEY })).toBe(
      smartoltAccountKey({ apiBaseUrl: API_BASE, apiKey: API_KEY }),
    );
  });
});

describe('el registro de guardias por cuenta', () => {
  it('devuelve el mismo guardia para la misma cuenta', () => {
    const clock = fakeClock();
    const first = getAccountRateGovernor('cuenta-1', SMARTOLT_DEFAULT_RATE_LIMIT, clock);
    const second = getAccountRateGovernor('cuenta-1', SMARTOLT_DEFAULT_RATE_LIMIT, clock);

    expect(second).toBe(first);
  });

  it('devuelve guardias distintos para cuentas distintas', () => {
    const clock = fakeClock();
    const first = getAccountRateGovernor('cuenta-1', SMARTOLT_DEFAULT_RATE_LIMIT, clock);
    const second = getAccountRateGovernor('cuenta-2', SMARTOLT_DEFAULT_RATE_LIMIT, clock);

    expect(second).not.toBe(first);
  });

  it('comparte el presupuesto por hora entre el guardia y el presupuesto de un endpoint', () => {
    const clock = fakeClock();
    const budget = getAccountHourlyBudget('cuenta-1', 1, clock);

    budget.consume('/api/onu/get_event_stream');
    expect(() => budget.consume('/api/onu/get_event_stream')).toThrow(SmartoltRateLimitError);
  });
});

describe('dos instancias del cliente para la misma cuenta', () => {
  it('comparten el presupuesto de la hora (el poll nuevo no reinicia el contador)', async () => {
    const first = new SmartOltClient({
      useMock: false,
      apiKey: API_KEY,
      apiBaseUrl: API_BASE,
      fetchImpl: oltsFetch(),
      rateLimit: { perHour: 2 },
    });
    const second = new SmartOltClient({
      useMock: false,
      apiKey: API_KEY,
      apiBaseUrl: API_BASE,
      fetchImpl: oltsFetch(),
      rateLimit: { perHour: 2 },
    });

    await first.listOlts();
    await second.listOlts();

    const error = await second.listOlts().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SmartoltRateLimitError);
    expect((error as SmartoltRateLimitError).violationType).toBe('per_hour');
  });

  it('no comparten nada cuando el cliente trae su propio reloj (tests deterministas)', async () => {
    const clock = fakeClock();
    const make = (): SmartOltClient =>
      new SmartOltClient({
        useMock: false,
        apiKey: API_KEY,
        apiBaseUrl: API_BASE,
        fetchImpl: oltsFetch(),
        rateLimit: { perHour: 1 },
        now: clock.now,
        sleep: clock.sleep,
      });

    await make().listOlts();
    await expect(make().listOlts()).resolves.toHaveLength(1);
  });
});
