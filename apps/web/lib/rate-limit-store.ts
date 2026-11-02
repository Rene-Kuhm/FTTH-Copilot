/**
 * SEC-008 — almacén de cuota con Redis, con respaldo en memoria.
 *
 * El middleware de Edge ya pone un límite por instancia, pero una ventana
 * con varias réplicas multiplica el límite real por el número de réplicas.
 * Este store hace que el límite sea **global**: todas las instancias de la
 * web cuentan en la misma Redis, la misma que usa la cola del worker.
 *
 * Dos reglas:
 *
 * 1. **Sin `REDIS_URL` no se cae nada.** El modo embebido y el desarrollo
 *    local pueden no tener Redis: ahí se usa el almacén en memoria y el
 *    límite es por instancia, como siempre.
 * 2. **Si Redis falla, la petición pasa.** Un limiter que tumba la API
 *    cuando parpadea la Redis es peor que no tener limiter. El middleware de
 *    Edge sigue aplicando su límite en memoria como red de seguridad.
 */
import Redis from 'ioredis';
import { NextResponse } from 'next/server';
import { createLogger } from '@ftth-copilot/shared';
import { redisConnectionOptions } from '@ftth-copilot/jobs';

import {
  RATE_LIMITS,
  createInMemoryRateLimitStore,
  getRateLimitKey,
  rateLimitResponse,
  type RateLimitConfig,
  type RateLimitResult,
  type RateLimitStore,
} from './rate-limit-core';

const log = createLogger({ name: 'rate-limit' });

/**
 * Prefijo de las claves en Redis.
 *
 * El Redis es compartido con la cola del worker y con lo que sea que el
 * despliegue deje en el mismo Redis: el prefijo evita pisar a otro consumidor.
 */
export const REDIS_KEY_PREFIX = 'ftth:rl:';

/**
 * Lo mínimo que el store necesita de un cliente de Redis.
 *
 * Es una interfaz propia y no la de ioredis para que el store se pueda
 * probar sin Redis y para que la dependencia no se filtre a la superficie
 * pública.
 */
export interface RateLimitRedisClient {
  eval(
    script: string,
    numberOfKeys: number,
    key: string,
    argument: string,
  ): Promise<unknown>;
  quit(): Promise<unknown>;
  /**
   * Espera a que el cliente esté listo para mandar comandos.
   *
   * Opcional: los clientes de prueba no lo necesitan. El de Redis sí, y por
   * eso es obligatorio en la implementación real (ver `createRedisClient`).
   */
  ensureReady?(): Promise<void>;
}

/**
 * Guion de Lua: cuenta y renueva la ventana en una sola operación atómica.
 *
 * `INCR` y `PEXPIRE` por separado dejarían una ventana sin caducidad si el
 * proceso muriese entre las dos, y dos comandos no son atómicos: con Lua,
 * Redis los ejecuta de a uno y nadie se cuela entre medio.
 *
 * Devuelve el conteo y el tiempo que le queda a la clave.
 */
const CONSUME_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
return {count, ttl}
`;

/**
 * Almacén con Redis.
 *
 * El cliente se puede inyectar: los tests no necesitan un Redis vivo.
 *
 * Cuando no se inyecta, el cliente se crea **en la primera cuenta**, no al
 * construir el store. Así el store se puede inspeccionar (y decidir si el
 * límite es global o por instancia) sin abrir un socket contra la Redis.
 */
export function createRedisRateLimitStore(
  url: string,
  client?: RateLimitRedisClient,
): RateLimitStore {
  let redis: RateLimitRedisClient | undefined = client;

  const getClient = (): RateLimitRedisClient => {
    redis ??= createRedisClient(url);
    return redis;
  };

  return {
    kind: 'redis',

    async consume(
      key: string,
      config: RateLimitConfig,
      now: number,
    ): Promise<RateLimitResult> {
      const redisKey = `${REDIS_KEY_PREFIX}${key}`;
      try {
        const client = getClient();
        // Antes del primer comando hay que esperar a que la conexión esté
        // lista: con la cola offline desactivada, un comando enviado durante
        // el handshake se pierde, y la petición passaría sin contar.
        await client.ensureReady?.();
        const raw = await client.eval(
          CONSUME_SCRIPT,
          1,
          redisKey,
          String(config.windowMs),
        );
        const [count, ttl] = Array.isArray(raw) ? raw : [1, config.windowMs];
        const used = typeof count === 'number' ? count : Number(count);
        const remainingMs = typeof ttl === 'number' ? ttl : Number(ttl);

        return {
          allowed: used <= config.max,
          remaining: Math.max(0, config.max - used),
          resetAt: now + (Number.isFinite(remainingMs) ? remainingMs : config.windowMs),
        };
      } catch (error) {
        // Redis no está: se deja pasar. El middleware de Edge sigue poniendo
        // su límite en memoria, así que la API no queda sin protección.
        log.warn('Rate limit store unavailable; request allowed', {
          error: error instanceof Error ? error : new Error(String(error)),
        });
        return {
          allowed: true,
          remaining: config.max,
          resetAt: now + config.windowMs,
        };
      }
    },

    async close(): Promise<void> {
      await redis?.quit();
    },
  };
}

/**
 * Cuánto se espera a que la conexión esté lista.
 *
 * Es el techo del fail-open: si la Redis no responde en este tiempo, la
 * petición pasa en vez de esperar.
 */
const READY_TIMEOUT_MS = 1_000;

/**
 * Espera a que el cliente esté listo.
 *
 * Con `enableOfflineQueue: false`, un comando que sale antes de que la
 * conexión esté lista **se pierde**: ioredis lo rechaza en vez de encolarlo.
 * Sin esta espera, las primeras peticiones de cada proceso no contarían y el
 * límite real sería mayor que el configurado.
 */
function waitForReady(client: Redis): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Redis no estuvo lista a tiempo'));
    }, READY_TIMEOUT_MS);

    function onReady(): void {
      cleanup();
      resolve();
    }

    function onError(error: Error): void {
      cleanup();
      reject(error);
    }

    function cleanup(): void {
      clearTimeout(timer);
      client.off('ready', onReady);
      client.off('error', onError);
    }

    client.once('ready', onReady);
    client.once('error', onError);
  });
}

/**
 * Cliente de Redis para el limiter.
 *
 * Comparte la Redis de la cola (`REDIS_URL`), pero con los ajustes de un
 * request path y no los de un productor de jobs:
 *
 * - `enableOfflineQueue: false` — con la Redis caída, el comando falla de
 *   inmediato en vez de quedar en la cola: una petición no espera a que
 *   vuelva la Redis.
 * - `connectTimeout` corto — una Redis inalcanzable no puede sumar segundos a
 *   cada petición.
 *
 * El listener de `error` no es opcional: ioredis emite ese evento cuando la
 * conexión falla y, sin un listener, el evento no manejado tumba el proceso.
 */
function createRedisClient(url: string): RateLimitRedisClient {
  const client = new Redis(url, {
    maxRetriesPerRequest: 3,
    connectTimeout: 1_000,
    enableOfflineQueue: false,
  });
  client.on('error', (error: Error) => {
    log.warn('Rate limit Redis client error', { error });
  });

  let ready: Promise<void> | undefined;

  return {
    eval: (script, numberOfKeys, key, argument) =>
      client.eval(script, numberOfKeys, key, argument),
    quit: () => client.quit(),
    ensureReady: async (): Promise<void> => {
      if (client.status === 'ready') return;
      ready ??= waitForReady(client).catch((error: unknown) => {
        // Se libera el estado: la próxima petición reintenta la conexión.
        ready = undefined;
        throw error;
      });
      return ready;
    },
  };
}

/**
 * Fábrica del almacén.
 *
 * Con `REDIS_URL` va a Redis (límite global); sin ella, en memoria (límite
 * por instancia, el de siempre).
 *
 * La URL sale de `redisConnectionOptions()` de `@ftth-copilot/jobs`: es la
 * misma Redis que usa la cola del worker, con la misma contraseña y el mismo
 * índice de base de datos.
 */
export function createRateLimitStore(env: NodeJS.ProcessEnv = process.env): RateLimitStore {
  const url = redisConnectionOptions(env).url;
  const configured = env['REDIS_URL']?.trim();
  if (!configured) {
    return { ...createInMemoryRateLimitStore(), kind: 'memory' };
  }
  return createRedisRateLimitStore(url);
}

let singleton: RateLimitStore | undefined;

/**
 * El store del proceso: uno solo, con una sola conexión.
 *
 * Una conexión por proceso, como la del worker con BullMQ.
 */
export function getRateLimitStore(env: NodeJS.ProcessEnv = process.env): RateLimitStore {
  if (!singleton) {
    singleton = createRateLimitStore(env);
  }
  return singleton;
}

/**
 * Aplica el límite a una petición de la API.
 *
 * Devuelve la respuesta 429 cuando la cuota está agotada, y `null` cuando
 * la petición puede seguir. El runtime de Node es el que puede usar Redis;
 * el middleware de Edge sigue con su límite en memoria.
 */
export async function enforceApiRateLimit(
  request: Request,
  tenantId: string | undefined,
  config: RateLimitConfig = RATE_LIMITS.mutation,
): Promise<NextResponse | null> {
  const store = getRateLimitStore();
  const key = getRateLimitKey(request, config.keyPrefix, tenantId);
  const result = await store.consume(key, config, Date.now());

  if (!result.allowed) {
    const response = rateLimitResponse(result.resetAt);
    return new NextResponse(response.body, {
      status: response.status,
      headers: response.headers,
    });
  }
  return null;
}
