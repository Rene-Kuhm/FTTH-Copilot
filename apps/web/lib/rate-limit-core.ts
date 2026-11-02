/**
 * SEC-008 — núcleo del rate limiter.
 *
 * El núcleo es puro: no depende del runtime, ni de Prisma, ni de Redis. Lo
 * usan las dos capas del repo:
 *
 * - el middleware de **Edge**, que solo puede guardar en memoria (Edge no
 *   tiene TCP, así que no puede hablar con Redis);
 * - el runtime de **Node**, que sí puede y usa Redis, de modo que el límite
 *   sea el mismo para todas las instancias de la web.
 *
 * Lo que cambia entre las dos es **el almacén**, nunca las cuentas. Por eso
 * el almacén es una interfaz: `RateLimitStore`.
 *
 * El almacén en memoria es por instancia. Con varias réplicas de la web, el
 * límite real es `max` por instancia. Por eso el runtime de Node usa
 * Redis cuando hay `REDIS_URL`, y el almacén en memoria queda como el
 * respaldo del modo embebido y del desarrollo local.
 */

/** Configuración de un límite. */
export interface RateLimitConfig {
  /** Peticiones admitidas por ventana. */
  max: number;
  /** Tamaño de la ventana, en milisegundos. */
  windowMs: number;
  /** Prefijo de la clave: separa un límite de otro. */
  keyPrefix: string;
}

/** Resultado de consumir una unidad de cuota. */
export interface RateLimitResult {
  /** `false` cuando la cuota está agotada. */
  allowed: boolean;
  /** Peticiones que quedan en la ventana. */
  remaining: number;
  /** Epoch en el que se reabre la ventana. */
  resetAt: number;
}

/**
 * Límites por defecto.
 *
 * `normal` y `auth` son los que aplica el middleware de Edge. `mutation` es
 * el que aplican las rutas que cambian estado: son más estrictas porque
 * escriben en la base y, en el caso de la investigación, gastan LLM.
 */
export const RATE_LIMITS = {
  normal: {
    max: 100,
    windowMs: 60 * 1000, // 1 minute
    keyPrefix: 'rl',
  },
  // Subido para el CI/E2E: Playwright corre 2 workers en paralelo y reintenta
  // una vez, `auth-real.spec.ts` hace unas 8 peticiones seguidas por test, y
  // varios specs tocan las rutas de auth. 200 req/min deja margen de sobra.
  auth: {
    max: 200,
    windowMs: 60 * 1000, // 1 minute
    keyPrefix: 'rl-auth',
  },
  // Rutas que mutan estado. El límite es global (Redis), no por instancia.
  mutation: {
    max: 60,
    windowMs: 60 * 1000, // 1 minute
    keyPrefix: 'rl-mut',
  },
} as const;

/**
 * Construye la clave de un límite.
 *
 * Con tenant, la cuota es del tenant; sin él, es de la IP. Una petición sin
 * autenticar no puede consumir la cuota de un tenant.
 */
export function getRateLimitKey(
  request: Request,
  keyPrefix: string,
  tenantId?: string,
): string {
  if (tenantId) {
    return `${keyPrefix}:tenant:${tenantId}`;
  }

  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded ? forwarded.split(',')[0]!.trim() : 'unknown';
  return `${keyPrefix}:ip:${ip}`;
}

/**
 * Respuesta 429 con la información de cuándo reintentar.
 */
export function rateLimitResponse(resetAt: number): Response {
  const retryAfter = Math.ceil((resetAt - Date.now()) / 1000);
  return new Response(
    JSON.stringify({
      error: 'Too many requests',
      retryAfter,
    }),
    {
      status: 429,
      headers: {
        'content-type': 'application/json',
        'retry-after': String(retryAfter),
        'x-ratelimit-reset': String(resetAt),
      },
    },
  );
}

/**
 * Almacén de contadores de cuota.
 *
 * `consume` tiene que ser **atómico**: dos peticiones concurrentes sobre la
 * misma clave no pueden leer el mismo contador y pasar las dos.
 */
export interface RateLimitStore {
  /** Qué almacén es: `memory` (por instancia) o `redis` (global). */
  readonly kind: 'memory' | 'redis';
  consume(
    key: string,
    config: RateLimitConfig,
    now: number,
  ): Promise<RateLimitResult>;
  /**
   * Cierra los recursos del almacén.
   *
   * Opcional: el almacén en memoria no tiene nada que cerrar. El de Redis
   * cierra la conexión, para que un proceso que termina no deje el socket
   * colgando.
   */
  close?(): Promise<void>;
}

/** Cada cuánto se barren las entradas vencidas del almacén en memoria. */
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Almacén en memoria: el de siempre, y el respaldo cuando no hay Redis.
 *
 * Vive en el proceso: con varias réplicas de la web, cada una cuenta por su
 * cuenta. Es el comportamiento correcto para el modo embebido y para el
 * desarrollo local, y el que se usa en Edge (que no puede hacer otra cosa).
 */
export function createInMemoryRateLimitStore(): RateLimitStore {
  const entries = new Map<string, { count: number; windowStart: number }>();
  let lastCleanup = 0;

  return {
    kind: 'memory',

    async consume(key, config, now) {
      // Sin `await` entre la lectura y la escritura: aunque la función sea
      // `async`, el tramo se ejecuta de corrido y no hay forma de que dos
      // peticiones concurrentes lean el mismo contador y las dos pasen.
      if (now - lastCleanup >= CLEANUP_INTERVAL_MS) {
        lastCleanup = now;
        for (const [entryKey, entry] of entries) {
          if (now - entry.windowStart >= config.windowMs) entries.delete(entryKey);
        }
      }

      const entry = entries.get(key);

      if (!entry || now - entry.windowStart >= config.windowMs) {
        entries.set(key, { count: 1, windowStart: now });
        return {
          allowed: true,
          remaining: config.max - 1,
          resetAt: now + config.windowMs,
        };
      }

      if (entry.count >= config.max) {
        return {
          allowed: false,
          remaining: 0,
          resetAt: entry.windowStart + config.windowMs,
        };
      }

      entry.count += 1;
      return {
        allowed: true,
        remaining: config.max - entry.count,
        resetAt: entry.windowStart + config.windowMs,
      };
    },
  };
}
