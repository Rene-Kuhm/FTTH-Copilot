/**
 * The contract of the health snapshot that the worker publishes.
 *
 * The registry of the loops (`./health.ts`) lives in the memory of the
 * process that runs them. When that process is the worker, the web cannot
 * read it from there: Next.js bundles the instrumentation and the route
 * handlers separately, so the web ends up with a *different* copy of the
 * registry — an empty one. The state has to travel through a channel both
 * processes share.
 *
 * The channel is Redis: the worker writes the snapshot under
 * `WORKER_HEALTH_KEY`, the web reads it. This module pins what travels, so
 * both ends agree on the shape without either of them knowing how the other
 * is implemented — and so a corrupted or unexpected value can never reach
 * the health endpoint as if it were a truth.
 *
 * The snapshot expires: a worker that dies stops refreshing it, and the key
 * disappears on its own. A green trace that outlives the process that left
 * it would be worse than no trace at all.
 */

import type { ServiceHealth } from './health';

/**
 * The Redis key the snapshot lives under.
 *
 * Namespaced like the rest of the keys of the deployment (`ftth:…`): the
 * Redis is shared with the queue and with whatever else the deployment
 * leaves in it, and the prefix keeps this key from being written over.
 */
export const WORKER_HEALTH_KEY = 'ftth:worker:scheduler-health';

/**
 * How long the snapshot stays valid, in seconds.
 *
 * The worker refreshes it several times per minute, so a snapshot that is
 * still there is a worker that is still alive. Sixty seconds is generous
 * enough to survive a slow tick and short enough that a dead worker is
 * noticed within a minute.
 */
export const WORKER_HEALTH_TTL_SECONDS = 60;

/** What the worker publishes: the state of its loops and when it said so. */
export interface WorkerHealthSnapshot {
  /** The state of every loop the worker registered, keyed by loop name. */
  services: Record<string, ServiceHealth>;
  /**
   * The counters of the ingest path of the worker.
   *
   * Plain numbers, by name: the backlog of the durable spool, the events
   * that were dropped, and the rest. They travel as they are so that the
   * web can report the loss of telemetry of the process that owns it — in
   * worker mode the web does not ingest anything, and its own counters are
   * always zero.
   */
  counters: Record<string, number>;
  /** Epoch milliseconds of the publication. */
  publishedAt: number;
}

/**
 * Builds the snapshot to publish.
 *
 * The time arrives as a parameter, like everywhere else in this repo: the
 * publisher decides the clock, the contract does not.
 */
export function buildWorkerHealthSnapshot(
  services: Record<string, ServiceHealth>,
  counters: Record<string, number> = {},
  now: number = Date.now(),
): WorkerHealthSnapshot {
  return { services, counters, publishedAt: now };
}

/** Whether a value is a finite number or null. */
function isNullableNumber(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value));
}

/**
 * Whether a value has the shape of a `ServiceHealth`.
 *
 * The check is strict on purpose: the snapshot comes from another process,
 * and a field with an unexpected type has to fail the whole snapshot
 * instead of being carried into the health endpoint as if it were true.
 */
function isServiceHealth(value: unknown): value is ServiceHealth {
  if (typeof value !== 'object' || value === null) return false;
  const service = value as Record<string, unknown>;
  if (typeof service['expected'] !== 'boolean') return false;
  if (!isNullableNumber(service['lastRunAt'])) return false;
  if (service['lastError'] !== null && typeof service['lastError'] !== 'string') return false;
  if (!isNullableNumber(service['lastErrorAt'])) return false;
  if (service['bound'] !== undefined && typeof service['bound'] !== 'boolean') return false;
  return true;
}

/**
 * Parses a published snapshot.
 *
 * Returns null for anything that is not a snapshot this module could have
 * built: no value, a value that is not JSON, a snapshot without services, or
 * a service with a field of the wrong type. A health endpoint that repeats
 * a corrupted value is worse than one that admits it does not know.
 */
export function parseWorkerHealthSnapshot(raw: string | null): WorkerHealthSnapshot | null {
  if (raw === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) return null;
  const candidate = parsed as Record<string, unknown>;

  const services = candidate['services'];
  if (typeof services !== 'object' || services === null || Array.isArray(services)) return null;

  // The counters are optional: a snapshot published before they existed is
  // still a valid one, and the web reports the absence of counters as the
  // absence of telemetry rather than as a broken contract.
  const rawCounters = candidate['counters'];
  const counters: Record<string, number> = {};
  if (rawCounters !== undefined) {
    if (typeof rawCounters !== 'object' || rawCounters === null || Array.isArray(rawCounters)) {
      return null;
    }
    for (const [name, value] of Object.entries(rawCounters)) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return null;
      counters[name] = value;
    }
  }

  const publishedAt = candidate['publishedAt'];
  if (typeof publishedAt !== 'number' || !Number.isFinite(publishedAt)) return null;

  const parsedServices: Record<string, ServiceHealth> = {};
  for (const [name, service] of Object.entries(services)) {
    if (!isServiceHealth(service)) return null;
    parsedServices[name] = service;
  }

  return { services: parsedServices, counters, publishedAt };
}
