/**
 * Redis connection settings for the queue.
 *
 * The connection options are passed to BullMQ as plain options and BullMQ
 * owns the client lifecycle (including the extra blocking connection a worker
 * needs). Keeping the options — rather than a client instance — means the
 * web and the worker never share a socket by accident.
 */

/** Redis URL used when `REDIS_URL` is not set. */
export const DEFAULT_REDIS_URL = 'redis://127.0.0.1:6379';

/**
 * Connection options accepted by BullMQ.
 *
 * Deliberately a local type instead of BullMQ's own: the public surface of
 * this package stays stable even if BullMQ reorganizes its exported types.
 */
export interface RedisConnectionOptions {
  /** `redis://` URL, including credentials and database index when used. */
  url: string;
  /**
   * How many times a command is retried before it fails.
   *
   * `null` means "retry forever", and BullMQ requires it for workers: their
   * blocking reads must not be cut short by a client-side retry limit.
   * Producers keep the default so a web request fails fast when Redis is
   * down instead of hanging until the request times out.
   */
  maxRetriesPerRequest?: number | null;
}

/** Reads `REDIS_URL`, falling back to a local Redis. */
export function redisUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env['REDIS_URL']?.trim();
  return raw && raw.length > 0 ? raw : DEFAULT_REDIS_URL;
}

/**
 * Connection options for a producer (the web enqueuing jobs).
 *
 * The retry limit is finite on purpose: a producer that cannot reach Redis
 * has to fail fast, not hang. With the default (20 retries with a growing
 * delay) a request that enqueues while Redis is unreachable — or with the
 * wrong password — waits instead of answering, and the caller cannot tell
 * whether the work was accepted.
 */
export function redisConnectionOptions(env: NodeJS.ProcessEnv = process.env): RedisConnectionOptions {
  return { url: redisUrl(env), maxRetriesPerRequest: 3 };
}

/**
 * Connection options for a consumer (the worker running jobs).
 *
 * `maxRetriesPerRequest: null` is mandatory for BullMQ workers.
 */
export function workerRedisConnectionOptions(
  env: NodeJS.ProcessEnv = process.env,
): RedisConnectionOptions {
  return { url: redisUrl(env), maxRetriesPerRequest: null };
}
