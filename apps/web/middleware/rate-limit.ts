/**
 * Límite grueso de peticiones en el middleware/proxy de Edge.
 *
 * En Next.js 16.3.8 `middleware.ts` compila al runtime de Edge, donde no hay
 * TCP: no puede hablar con Redis ni usar Prisma. Por eso este límite corre
 * únicamente en memoria y es **por instancia** (con varias réplicas de la web,
 * el límite real es `max` por réplica).
 *
 * Para coordinar cuotas entre réplicas, las superficies que corren en **Node**
 * (los route handlers, vía `enforceApiRateLimit`) usan el store compartido de
 * `lib/rate-limit-store.ts` con `REDIS_URL`. Ambos caminos comparten el núcleo
 * puro (`lib/rate-limit-core.ts`) para no divergir en las cuentas.
 */
import {
  RATE_LIMITS,
  createInMemoryRateLimitStore,
  getRateLimitKey,
  rateLimitResponse,
  type RateLimitConfig,
  type RateLimitResult,
} from '../lib/rate-limit-core';

export { RATE_LIMITS, getRateLimitKey, rateLimitResponse };
export type { RateLimitConfig, RateLimitResult };

const store = createInMemoryRateLimitStore();

/**
 * Comprueba el límite de una clave en el almacén en memoria de la instancia.
 *
 * Devuelve { allowed: boolean; remaining: number; resetAt: number }.
 */
export async function checkRateLimit(
  key: string,
  config: RateLimitConfig,
): Promise<RateLimitResult> {
  return store.consume(key, config, Date.now());
}
