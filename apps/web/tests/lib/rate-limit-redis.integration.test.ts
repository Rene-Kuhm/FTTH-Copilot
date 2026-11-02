/**
 * SEC-008 — el límite con Redis, contra una Redis de verdad.
 *
 * Lo que la suite de unidad no puede probar es lo que importa de un
 * store distribuido: que **dos instancias comparten la cuenta**. Con el
 * almacén en memoria cada una cuenta por su cuenta; con Redis no.
 *
 * La suite necesita una Redis viva: apuntá `RATE_LIMIT_TEST_REDIS_URL` a
 * una. Sin la variable se salta sola, para que la corrida hermética siga
 * en verde (misma convención que el resto del repo).
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createRedisRateLimitStore, REDIS_KEY_PREFIX } from '@/lib/rate-limit-store';
import type { RateLimitConfig } from '@/lib/rate-limit-core';

const REDIS_URL = process.env['RATE_LIMIT_TEST_REDIS_URL'];
const redisSuite = REDIS_URL ? describe : describe.skip;

const CONFIG: RateLimitConfig = { max: 3, windowMs: 60_000, keyPrefix: 'rl-it' };

/** Clave relativa: la que se le pasa a `consume`. */
function keyFor(suffix: string): string {
  return `rl-it:tenant:${suffix}`;
}

/** La misma clave en Redis: el store le antepone su propio prefijo. */
function redisKeyFor(suffix: string): string {
  return `${REDIS_KEY_PREFIX}${keyFor(suffix)}`;
}

async function clear(suffixes: string[]): Promise<void> {
  const { default: Redis } = await import('ioredis');
  const client = new Redis(REDIS_URL as string, { maxRetriesPerRequest: 3 });
  try {
    await client.del(...suffixes.map(redisKeyFor));
  } finally {
    await client.quit();
  }
}

/** Los stores abiertos en la corrida, para cerrar sus conexiones al final. */
const abiertos: Array<{ close?: () => Promise<void> }> = [];

function nuevoStore(): ReturnType<typeof createRedisRateLimitStore> {
  const store = createRedisRateLimitStore(REDIS_URL as string);
  abiertos.push(store);
  return store;
}

redisSuite('rate limit con Redis (integración)', () => {
  beforeEach(async () => {
    await clear(['a', 'b', 'concurrencia', 'ventana']);
  });

  afterAll(async () => {
    await Promise.all(abiertos.map((store) => store.close?.()));
    await clear(['a', 'b', 'concurrencia', 'ventana']);
  });

  it('dos instancias del store comparten la misma cuenta', async () => {
    const primera = nuevoStore();
    const segunda = nuevoStore();

    await primera.consume(keyFor('a'), CONFIG, 1_760_000_000_000);
    await primera.consume(keyFor('a'), CONFIG, 1_760_000_000_001);
    const desdeLaSegunda = await segunda.consume(keyFor('a'), CONFIG, 1_760_000_000_002);
    const cuarta = await segunda.consume(keyFor('a'), CONFIG, 1_760_000_000_003);

    expect(desdeLaSegunda.allowed).toBe(true);
    expect(desdeLaSegunda.remaining).toBe(0);
    // La cuarta es la que pasa del cupo: la ve la otra instancia.
    expect(cuarta.allowed).toBe(false);
  });

  it('la ventana se reabre cuando la clave caduca', async () => {
    const store = nuevoStore();
    const config: RateLimitConfig = { max: 1, windowMs: 300, keyPrefix: 'rl-it' };

    const primera = await store.consume(keyFor('ventana'), config, Date.now());
    const segunda = await store.consume(keyFor('ventana'), config, Date.now());
    expect(primera.allowed).toBe(true);
    expect(segunda.allowed).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 350));

    const trasLaVentana = await store.consume(keyFor('ventana'), config, Date.now());
    expect(trasLaVentana.allowed).toBe(true);
  });

  it('peticiones concurrentes: solo pasan las del cupo', async () => {
    const store = nuevoStore();
    const now = 1_760_000_000_000;

    const resultados = await Promise.all(
      Array.from({ length: 10 }, () => store.consume(keyFor('concurrencia'), CONFIG, now)),
    );

    expect(resultados.filter((r) => r.allowed)).toHaveLength(CONFIG.max);
    expect(resultados.filter((r) => !r.allowed)).toHaveLength(10 - CONFIG.max);
  });

  it('la primera cuenta de un store nuevo ya cuenta: la conexión está lista', async () => {
    const store = nuevoStore();

    const primera = await store.consume(keyFor('a'), CONFIG, Date.now());
    const segunda = await store.consume(keyFor('a'), CONFIG, Date.now());

    // Si el primer comando se perdiera durante el handshake, las dos
    // peticiones pasarían con la cuota entera.
    expect(primera.remaining).toBe(CONFIG.max - 1);
    expect(segunda.remaining).toBe(CONFIG.max - 2);
  });
});
