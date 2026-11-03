/**
 * The web reads the state of the loops from the worker.
 *
 * In worker mode the loops run in the worker, and the health endpoint is
 * served by the web. The web cannot read the registry of the worker from
 * its own memory: it does not even have the same copy of the registry as
 * the instrumentation that starts the loops, because Next.js bundles each
 * entry point separately. What the web has is Redis — the one channel both
 * processes share — where the worker publishes the state of its loops.
 *
 * The read fails open: if the snapshot is missing or Redis is unreachable,
 * the answer is "I do not know", not an error. A health endpoint that
 * throws when a dependency blinks takes the whole API down with it, and
 * the absence of a snapshot is a fact the endpoint has to report, not a
 * failure of its own.
 */
import Redis from 'ioredis';
import {
  WORKER_HEALTH_KEY,
  parseWorkerHealthSnapshot,
  type WorkerHealthSnapshot,
} from '@ftth-copilot/scheduler';
import { createLogger } from '@ftth-copilot/shared';

const log = createLogger({ name: 'worker-health' });

/**
 * The minimum of the Redis client that the reader needs.
 *
 * A local interface, not the one of ioredis: the reader can then be tested
 * without Redis, and the dependency does not leak into the surface of this
 * module.
 */
export interface WorkerHealthReader {
  get(key: string): Promise<string | null>;
}

/**
 * Reads the snapshot of the worker through a reader.
 *
 * Returns null when the worker published nothing, when what it published is
 * not a snapshot, or when the reader could not reach Redis.
 */
export async function readWorkerHealthWith(
  reader: WorkerHealthReader,
  key: string = WORKER_HEALTH_KEY,
): Promise<WorkerHealthSnapshot | null> {
  let raw: string | null;
  try {
    raw = await reader.get(key);
  } catch (error) {
    log.warn('Could not read the health snapshot of the worker', { error });
    return null;
  }
  return parseWorkerHealthSnapshot(raw);
}

/**
 * The Redis client of the reader.
 *
 * It shares the Redis of the queue (`REDIS_URL`), with the settings of a
 * request path: the command fails immediately when Redis is unreachable
 * instead of waiting for it to come back, and the connection timeout is
 * short so an unreachable Redis cannot add seconds to every request.
 *
 * The `error` listener is not optional: ioredis emits that event when the
 * connection fails, and an unhandled event takes the process down.
 */
function createReader(url: string): WorkerHealthReader {
  const client = new Redis(url, {
    maxRetriesPerRequest: 1,
    connectTimeout: 1_000,
    enableOfflineQueue: false,
  });
  client.on('error', (error: Error) => {
    log.warn('Worker health Redis client error', { error });
  });

  return {
    get: (key) => client.get(key),
  };
}

/**
 * The reader of this process, created the first time it is needed.
 *
 * `null` means "there is no Redis to read from": the mode that does not
 * use the worker has no snapshot to look for.
 */
let reader: WorkerHealthReader | null | undefined;

/** The reader of this process, or null when there is no Redis. */
function getReader(): WorkerHealthReader | null {
  if (reader !== undefined) return reader;
  const url = process.env['REDIS_URL']?.trim();
  reader = url && url.length > 0 ? createReader(url) : null;
  return reader;
}

/**
 * Reads the health snapshot of the worker.
 *
 * Returns null when the worker is not running, has not published yet, or
 * when Redis could not be reached.
 */
export async function readWorkerHealth(): Promise<WorkerHealthSnapshot | null> {
  const current = getReader();
  if (current === null) return null;
  return readWorkerHealthWith(current);
}
