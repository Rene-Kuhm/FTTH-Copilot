/**
 * Límite de peticiones en el middleware de Edge.
 *
 * El middleware corre en el runtime de Edge, donde no hay TCP: no puede
 * hablar con Redis, y tampoco puede usar Prisma. Así que el límite que aplica
 * es **por instancia**: con varias réplicas de la web, el límite real es `max`
 * por réplica.
 *
 * Por eso el runtime de Node tiene su propio almacén (`lib/rate-limit-store.ts`)
 * con Redis, donde el límite es global. Los dos usan el mismo núcleo
 * (`lib/rate-limit-core.ts`), así que las cuentas no pueden divergir.
 *
 * El middleware conserva el límite grueso: es el camino rápido que corre
 * antes que cualquier ruta, y es la red de seguridad cuando la Redis no está.
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
 * Comprueba el límite de una clave.
 *
 * Devuelve { allowed: boolean; remaining: number; resetAt: number }.
 */
export async function checkRateLimit(
  key: string,
  config: RateLimitConfig,
): Promise<RateLimitResult> {
  return store.consume(key, config, Date.now());
}
