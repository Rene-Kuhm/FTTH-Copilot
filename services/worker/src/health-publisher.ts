/**
 * The worker publishes the state of its loops.
 *
 * The registry of the loops lives in the memory of the process that runs
 * them. That process is the worker, and the health endpoint is served by the
 * web: two processes, two memories. The web cannot read the registry of the
 * worker — it does not even have the same copy of the registry as the
 * instrumentation that starts the loops, because Next.js bundles each entry
 * point separately.
 *
 * So the state travels through Redis, the one channel both processes share.
 * The worker writes its snapshot under the key of the contract
 * (`WORKER_HEALTH_KEY`) and the web reads it from there.
 *
 * The write expires on its own: a worker that dies stops refreshing the key
 * and it disappears. A green trace that outlives the process that left it
 * would be worse than no trace at all — the operator would see a healthy
 * worker that stopped working minutes ago.
 */

import {
  WORKER_HEALTH_KEY,
  WORKER_HEALTH_TTL_SECONDS,
  buildWorkerHealthSnapshot,
  snapshotHealth,
  type ServiceHealth,
} from '@ftth-copilot/scheduler';
import { eventIngestStats } from '@ftth-copilot/ingest';
import { createLogger } from '@ftth-copilot/shared';

const log = createLogger({ name: 'health-publisher' });

/**
 * How often the snapshot is refreshed.
 *
 * Well below the TTL of the snapshot, so a single failed write does not
 * leave the key without a publisher for long.
 */
export const DEFAULT_PUBLISH_INTERVAL_MS = 20_000;

/**
 * How often a failed publication is reported.
 *
 * Redis being down is not rare, and the publisher tries every twenty
 * seconds: without a throttle the log would repeat the same failure three
 * times a minute for as long as the outage lasts.
 */
export const FAILURE_LOG_THROTTLE_MS = 60_000;

/**
 * The minimum of the Redis client that the publisher needs.
 *
 * A local interface, not the one of ioredis: the publisher can then be
 * tested without Redis, and the dependency does not leak into the surface
 * of this module.
 */
export interface HealthPublisherClient {
  set(key: string, value: string, mode: 'EX', ttlSeconds: number): Promise<unknown>;
}

/** Options of the publisher. */
export interface HealthPublisherOptions {
  /** The Redis client the snapshot is written with. */
  client: HealthPublisherClient;
  /** The key to write. Defaults to the one of the contract. */
  key?: string;
  /** The expiry of the key. Defaults to the one of the contract. */
  ttlSeconds?: number;
  /** The clock. Defaults to `Date.now`. */
  now?: () => number;
  /**
   * The state of the loops to publish.
   *
   * Defaults to the registry of this process. It is a parameter so the
   * publisher can be tested with a state of its own.
   */
  services?: () => Record<string, ServiceHealth>;
  /**
   * The counters of the ingest path to publish.
   *
   * Defaults to the counters of the durable spool of this process. The
   * worker owns the spool in worker mode, so its backlog and its losses are
   * the ones the web has to report.
   */
  counters?: () => Record<string, number>;
}

/** A publisher of the health snapshot. */
export interface HealthPublisher {
  /** Writes the snapshot. Returns whether it made it to Redis. */
  publish(): Promise<boolean>;
}

/**
 * Keeps the numeric counters of an object and drops the rest.
 *
 * The counters of the ingest path arrive as a typed object, but the
 * contract carries them as plain numbers by name. The conversion happens
 * here, at the edge, and it is checked: a counter that is not a number
 * does not travel as if it were one.
 */
function numericCounters(source: object): Record<string, number> {
  const counters: Record<string, number> = {};
  for (const [name, value] of Object.entries(source)) {
    if (typeof value === 'number') counters[name] = value;
  }
  return counters;
}

/**
 * Builds a publisher of the health snapshot.
 *
 * A failed write is reported, not thrown: the worker must not die because
 * the health snapshot could not be published. The key expires on its own,
 * and the next tick publishes again.
 */
export function createHealthPublisher(options: HealthPublisherOptions): HealthPublisher {
  const key = options.key ?? WORKER_HEALTH_KEY;
  const ttlSeconds = options.ttlSeconds ?? WORKER_HEALTH_TTL_SECONDS;
  const now = options.now ?? Date.now;
  const services = options.services ?? snapshotHealth;
  const counters = options.counters ?? (() => numericCounters(eventIngestStats()));

  let lastFailureAt = Number.NEGATIVE_INFINITY;

  return {
    async publish(): Promise<boolean> {
      const snapshot = buildWorkerHealthSnapshot(services(), counters(), now());
      try {
        await options.client.set(key, JSON.stringify(snapshot), 'EX', ttlSeconds);
        return true;
      } catch (error) {
        const at = now();
        if (at - lastFailureAt >= FAILURE_LOG_THROTTLE_MS) {
          lastFailureAt = at;
          log.warn('Could not publish the health snapshot', { error });
        }
        return false;
      }
    },
  };
}

/** A running publisher. */
export interface HealthPublisherHandle {
  /** Stops publishing. */
  stop(): void;
}

/**
 * Starts a publisher that refreshes the snapshot on its own.
 *
 * The first publication happens right away: the web must be able to report
 * the state of the worker as soon as the worker is up, not one interval
 * later.
 */
export function startHealthPublisher(
  options: HealthPublisherOptions & { intervalMs?: number },
): HealthPublisherHandle {
  const publisher = createHealthPublisher(options);
  const intervalMs = options.intervalMs ?? DEFAULT_PUBLISH_INTERVAL_MS;

  const timer = setInterval(() => {
    void publisher.publish();
  }, intervalMs);
  // The timer must not keep the process alive on its own: the worker exits
  // through its own shutdown handler.
  timer.unref();

  void publisher.publish();

  return {
    stop(): void {
      clearInterval(timer);
    },
  };
}
