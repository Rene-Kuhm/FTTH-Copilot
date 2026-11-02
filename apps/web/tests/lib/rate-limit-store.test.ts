/**
 * SEC-008 — almacén de cuota con Redis y su respaldo en memoria.
 *
 * El punto de este store es el respaldo: si no hay `REDIS_URL` (modo
 * embebido, desarrollo local, una instalación sin Redis) el limiter sigue
 * funcionando, pero por instancia. Con `REDIS_URL` el límite es global.
 */
import { describe, expect, it } from 'vitest';

import {
  createRateLimitStore,
  createRedisRateLimitStore,
  getRateLimitStore,
  type RateLimitRedisClient,
} from '@/lib/rate-limit-store';

const CONFIG = { max: 3, windowMs: 60_000, keyPrefix: 'rl-test' };

/** Entorno con las variables que hace falta, sobre el del proceso. */
function envWith(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

/** Cliente de Redis de mentira: devuelve lo que le pidan y anota las claves. */
interface FakeClient extends RateLimitRedisClient {
  readonly calls: string[];
}

function fakeClient(responses: Array<[number, number]>): FakeClient {
  const calls: string[] = [];
  let index = 0;
  return {
    calls,
    async eval(_script: string, _numberOfKeys: number, key: string): Promise<unknown> {
      calls.push(key);
      const response = responses[Math.min(index, responses.length - 1)] ?? [1, 60_000];
      index += 1;
      return response;
    },
    async quit(): Promise<unknown> {
      return 'OK';
    },
  };
}

describe('createRateLimitStore — el respaldo en memoria', () => {
  it('sin REDIS_URL usa el almacén en memoria', () => {
    const store = createRateLimitStore(envWith({ REDIS_URL: undefined }));

    expect(store.kind).toBe('memory');
  });

  it('con REDIS_URL usa el almacén de Redis', () => {
    const store = createRateLimitStore(envWith({ REDIS_URL: 'redis://127.0.0.1:6379' }));

    expect(store.kind).toBe('redis');
  });

  it('una REDIS_URL vacía cuenta como ausente', () => {
    const store = createRateLimitStore(envWith({ REDIS_URL: '   ' }));

    expect(store.kind).toBe('memory');
  });
});

describe('createRedisRateLimitStore — la cuenta vive en Redis', () => {
  it('consume contra Redis y devuelve lo que cuenta', async () => {
    const client = fakeClient([[1, 60_000]]);
    const store = createRedisRateLimitStore('redis://127.0.0.1:6379', client);

    const result = await store.consume('rl:tenant:t1', CONFIG, 1_760_000_000_000);

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(CONFIG.max - 1);
  });

  it('la clave lleva un namespace para no pisar a otro consumidor del Redis', async () => {
    const client = fakeClient([[1, 60_000]]);
    const store = createRedisRateLimitStore('redis://127.0.0.1:6379', client);

    await store.consume('rl:tenant:t1', CONFIG, 1_760_000_000_000);

    expect(client.calls[0]).toContain('rl:tenant:t1');
    expect(client.calls[0]).not.toBe('rl:tenant:t1');
  });

  it('la petición que agota el cupo pasa, pero sin queda ninguna', async () => {
    const client = fakeClient([[CONFIG.max, 60_000]]);
    const store = createRedisRateLimitStore('redis://127.0.0.1:6379', client);

    const result = await store.consume('rl:tenant:t1', CONFIG, 1_760_000_000_000);

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(0);
  });

  it('bloquea cuando el contador pasa del máximo', async () => {
    const client = fakeClient([[CONFIG.max + 1, 60_000]]);
    const store = createRedisRateLimitStore('redis://127.0.0.1:6379', client);

    const result = await store.consume('rl:tenant:t1', CONFIG, 1_760_000_000_000);

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('si Redis falla, la petición pasa: el limiter no puede tirar la API', async () => {
    const client: RateLimitRedisClient = {
      async eval(): Promise<unknown> {
        throw new Error('connection refused');
      },
      async quit(): Promise<unknown> {
        return 'OK';
      },
    };
    const store = createRedisRateLimitStore('redis://127.0.0.1:6379', client);

    const result = await store.consume('rl:tenant:t1', CONFIG, 1_760_000_000_000);

    expect(result.allowed).toBe(true);
  });

  it('el error de Redis no se propaga', async () => {
    const client: RateLimitRedisClient = {
      async eval(): Promise<unknown> {
        throw new Error('connection refused');
      },
      async quit(): Promise<unknown> {
        return 'OK';
      },
    };
    const store = createRedisRateLimitStore('redis://127.0.0.1:6379', client);

    await expect(store.consume('rl:tenant:t1', CONFIG, 1)).resolves.toBeDefined();
  });
});

describe('getRateLimitStore — un cliente por proceso', () => {
  it('devuelve la misma instancia: una sola conexión por proceso', () => {
    const primero = getRateLimitStore(envWith({ REDIS_URL: undefined }));
    const segundo = getRateLimitStore(envWith({ REDIS_URL: undefined }));

    expect(primero).toBe(segundo);
  });
});
