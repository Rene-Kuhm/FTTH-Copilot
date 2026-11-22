/**
 * Límite de peticiones del proxy (antes `middleware`).
 *
 * Next.js 16 corre el proxy en el runtime de Node, así que ya no hay una
 * barrera de TCP: el límite usa el mismo store global que las rutas de la API
 * (`lib/rate-limit-store.ts`). Con `REDIS_URL` la cuenta es de todas las
 * réplicas; sin ella, o si Redis falla, el store cae a memoria y el límite
 * queda por instancia, con un aviso en los logs.
 *
 * Las cuentas no divergen porque ambos caminos comparten el núcleo puro
 * (`lib/rate-limit-core.ts`) y el prefijo de cada límite es distinto
 * (`rl`, `rl-auth` para el proxy; `rl-mut` para las mutaciones de la API).
 */
import {
  RATE_LIMITS,
  getRateLimitKey,
  rateLimitResponse,
  type RateLimitConfig,
  type RateLimitResult,
} from '../lib/rate-limit-core';
import { getRateLimitStore } from '../lib/rate-limit-store';

export { RATE_LIMITS, getRateLimitKey, rateLimitResponse };
export type { RateLimitConfig, RateLimitResult };

/**
 * Comprueba el límite de una clave.
 *
 * Devuelve { allowed: boolean; remaining: number; resetAt: number }.
 */
export async function checkRateLimit(
  key: string,
  config: RateLimitConfig,
): Promise<RateLimitResult> {
  return getRateLimitStore().consume(key, config, Date.now());
}
