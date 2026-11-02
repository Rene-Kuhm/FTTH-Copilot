/**
 * SEC-008 — núcleo del rate limiter.
 *
 * El núcleo es puro y no depende de runtime: lo usan tanto el middleware de
 * Edge (que solo puede guardar en memoria) como el runtime de Node (que
 * puede hablar con Redis). Lo que cambia entre los dos es **el almacén**,
 * nunca las cuentas.
 */
import { describe, expect, it } from 'vitest';

import {
  RATE_LIMITS,
  createInMemoryRateLimitStore,
  getRateLimitKey,
  rateLimitResponse,
  type RateLimitConfig,
} from '@/lib/rate-limit-core';

const CONFIG: RateLimitConfig = { max: 3, windowMs: 60_000, keyPrefix: 'rl-test' };

describe('rate limit — ventana', () => {
  it('deja pasar las primeras peticiones y cuenta las restantes', async () => {
    const store = createInMemoryRateLimitStore();
    const now = 1_760_000_000_000;

    const primero = await store.consume('k', CONFIG, now);
    const segundo = await store.consume('k', CONFIG, now + 1);

    expect(primero.allowed).toBe(true);
    expect(primero.remaining).toBe(2);
    expect(segundo.allowed).toBe(true);
    expect(segundo.remaining).toBe(1);
  });

  it('bloquea al agotar la cuota y dice cuándo se reabre', async () => {
    const store = createInMemoryRateLimitStore();
    const now = 1_760_000_000_000;

    await store.consume('k', CONFIG, now);
    await store.consume('k', CONFIG, now + 1);
    await store.consume('k', CONFIG, now + 2);
    const bloqueada = await store.consume('k', CONFIG, now + 3);

    expect(bloqueada.allowed).toBe(false);
    expect(bloqueada.remaining).toBe(0);
    expect(bloqueada.resetAt).toBe(now + CONFIG.windowMs);
  });

  it('reabre la ventana cuando expira', async () => {
    const store = createInMemoryRateLimitStore();
    const now = 1_760_000_000_000;

    await store.consume('k', CONFIG, now);
    await store.consume('k', CONFIG, now + 1);
    await store.consume('k', CONFIG, now + 2);
    expect((await store.consume('k', CONFIG, now + 3)).allowed).toBe(false);

    // La ventana venció: la cuota vuelve a estar limpia.
    const trasLaVentana = await store.consume('k', CONFIG, now + CONFIG.windowMs);
    expect(trasLaVentana.allowed).toBe(true);
    expect(trasLaVentana.remaining).toBe(CONFIG.max - 1);
  });

  it('las claves son independientes entre sí', async () => {
    const store = createInMemoryRateLimitStore();
    const now = 1_760_000_000_000;

    await store.consume('a', CONFIG, now);
    await store.consume('a', CONFIG, now + 1);
    await store.consume('a', CONFIG, now + 2);
    expect((await store.consume('a', CONFIG, now + 3)).allowed).toBe(false);

    expect((await store.consume('b', CONFIG, now + 4)).allowed).toBe(true);
  });
});

describe('rate limit — concurrencia', () => {
  it('diez peticiones concurrentes: solo las del cupo pasan', async () => {
    const store = createInMemoryRateLimitStore();
    const now = 1_760_000_000_000;

    const resultados = await Promise.all(
      Array.from({ length: 10 }, (_, i) => store.consume('k', CONFIG, now + i)),
    );

    const permitidas = resultados.filter((r) => r.allowed);
    const bloqueadas = resultados.filter((r) => !r.allowed);

    expect(permitidas).toHaveLength(CONFIG.max);
    expect(bloqueadas).toHaveLength(10 - CONFIG.max);
    // La última que pasa es la que agota la cuota: ninguna se cuela.
    expect(Math.min(...permitidas.map((r) => r.remaining))).toBe(0);
  });

  it('peticiones concurrentes sobre claves distintas no se interfieren', async () => {
    const store = createInMemoryRateLimitStore();
    const now = 1_760_000_000_000;

    const resultados = await Promise.all(
      Array.from({ length: 10 }, (_, i) => store.consume(`k${i}`, CONFIG, now)),
    );

    expect(resultados.every((r) => r.allowed)).toBe(true);
    expect(resultados.every((r) => r.remaining === CONFIG.max - 1)).toBe(true);
  });
});

describe('rate limit — clave y respuesta', () => {
  it('la clave lleva el tenant cuando lo hay', () => {
    const request = new Request('https://app.test/api/alerts');

    expect(getRateLimitKey(request, 'rl', 'tenant-1')).toBe('rl:tenant:tenant-1');
  });

  it('sin tenant la clave cae a la IP del x-forwarded-for', () => {
    const request = new Request('https://app.test/api/alerts', {
      headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' },
    });

    expect(getRateLimitKey(request, 'rl')).toBe('rl:ip:203.0.113.7');
  });

  it('sin tenant ni IP la clave es desconocida', () => {
    expect(getRateLimitKey(new Request('https://app.test/api/alerts'), 'rl')).toBe(
      'rl:ip:unknown',
    );
  });

  it('la respuesta 429 dice cuándo reintentar', () => {
    const resetAt = Date.now() + 30_000;
    const response = rateLimitResponse(resetAt);

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('30');
    expect(response.headers.get('x-ratelimit-reset')).toBe(String(resetAt));
  });
});

describe('rate limit — límites por defecto', () => {
  it('el límite normal es de 100 por minuto', () => {
    expect(RATE_LIMITS.normal.max).toBe(100);
    expect(RATE_LIMITS.normal.windowMs).toBe(60_000);
  });

  it('el límite de mutaciones existe y es más estricto que el normal', () => {
    expect(RATE_LIMITS.mutation.max).toBeLessThan(RATE_LIMITS.normal.max);
    expect(RATE_LIMITS.mutation.windowMs).toBe(60_000);
  });
});
