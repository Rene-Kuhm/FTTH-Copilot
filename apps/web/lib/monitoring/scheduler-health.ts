/**
 * Process-local scheduler health state.
 *
 * Background (Fase F / monitoring contract):
 *
 * The previous `/api/health` route only returned process metrics
 * (`uptime`, memory, version) and a static `{ status: 'ok' }`. It did
 * not actually check that the scheduled loops (`startPollingLoop`,
 * `startFirmwareAuditLoop`, `startFecCollectionLoop`, the syslog
 * receiver) were running. A syslog socket that failed to bind (e.g.
 * port already in use) would never surface in the health response, so
 * the NOC saw "ok" while telemetry silently stopped.
 *
 * This module is a small process-local registry that the scheduled
 * loops update after every tick (success or failure) and after every
 * socket bind attempt (success or failure). The `/api/health` route
 * reads it and reports per-service status. No persistent storage is
 * involved — two Node instances would each maintain their own state.
 * Acceptable for the current single-instance production target.
 *
 * Each service has:
 *   - `expected`     — whether the service is configured to run in this
 *                       process (driven by env flags like
 *                       METRICS_POLLER_ENABLED).
 *   - `lastRunAt`    — epoch ms of the last completed tick, or null.
 *   - `lastError`    — message of the last error, or null.
 *   - `lastErrorAt`  — epoch ms of the last error, or null.
 *   - `bound`        — for syslog: whether the UDP socket is currently
 *                       bound. False after a bind error or socket close.
 */

export type SchedulerName = 'polling' | 'firmware' | 'fec' | 'syslog' | 'syslog-detection';

export interface ServiceHealth {
  expected: boolean;
  lastRunAt: number | null;
  lastError: string | null;
  lastErrorAt: number | null;
  bound?: boolean;
}

const STATE = new Map<SchedulerName, ServiceHealth>();

/** Testing-only helper: clears all registered service state. */
export function __resetSchedulerHealth(): void {
  STATE.clear();
}

function getOrCreate(name: SchedulerName, expected: boolean): ServiceHealth {
  let s = STATE.get(name);
  if (s === undefined) {
    s = {
      expected,
      lastRunAt: null,
      lastError: null,
      lastErrorAt: null,
    };
    STATE.set(name, s);
  } else {
    // Update expected on every call so a process whose env toggled
    // during startup reflects the current intent.
    s.expected = expected;
  }
  return s;
}

/** Mark a service as configured to run (env flag enabled). */
export function markExpected(name: SchedulerName): ServiceHealth {
  return getOrCreate(name, true);
}

/** Mark a service as not configured to run (env flag disabled). */
export function markNotExpected(name: SchedulerName): ServiceHealth {
  return getOrCreate(name, false);
}

/** Record a successful tick. Clears the last-error fields. */
export function recordSuccess(name: SchedulerName, now: number = Date.now()): void {
  const s = getOrCreate(name, STATE.get(name)?.expected ?? false);
  s.lastRunAt = now;
  s.lastError = null;
  s.lastErrorAt = null;
}

/** Record a tick error. Keeps the last-run timestamp intact. */
export function recordError(name: SchedulerName, error: string, now: number = Date.now()): void {
  const s = getOrCreate(name, STATE.get(name)?.expected ?? false);
  s.lastError = error;
  s.lastErrorAt = now;
}

/** Record that the syslog UDP socket bound successfully. */
export function recordSyslogBound(bound: boolean): void {
  const s = getOrCreate('syslog', STATE.get('syslog')?.expected ?? false);
  s.bound = bound;
}

/** Read the current snapshot of all registered services. */
export function snapshotHealth(): Record<string, ServiceHealth> {
  // Object.entries(STATE) is wrong: Map instances have no enumerable
  // own properties, so it returned {} and the /api/health endpoint
  // could never see any registered service. Object.fromEntries
  // iterates the Map directly. The previous bug masked every
  // scheduler/syslog error because /api/health always reported
  // `services: {}` and `healthy: true`.
  return Object.fromEntries(
    Array.from(STATE, ([name, s]) => [name, { ...s }]),
  );
}

/**
 * Per-service "is the loop hung?" check (Fase 2 — 2.6).
 *
 * A loop is considered hung when its last successful tick is older
 * than `staleAfterMs` (default 10 minutes). Returns the list of
 * services that are expected AND have not produced a tick in that
 * window. Pure: same snapshot → same list.
 */
export function detectHangedLoops(
  snapshot: Record<string, ServiceHealth>,
  now: number,
  staleAfterMs: number = 10 * 60 * 1000,
): SchedulerName[] {
  const out: SchedulerName[] = [];
  for (const [name, s] of Object.entries(snapshot) as Array<[SchedulerName, ServiceHealth]>) {
    if (!s.expected) continue;
    if (s.lastRunAt === null) {
      // Never ran — counted as hung, not as recovered. This is the
      // "ausencia de primera ejecución" case the roadmap requires.
      out.push(name);
      continue;
    }
    if (now - s.lastRunAt > staleAfterMs) out.push(name);
  }
  return out;
}

/**
 * Compute the overall verdict: `true` (healthy) iff every expected
 * service is either running cleanly OR has no recent error.
 *
 * "Recent" is configurable; default is 5 minutes. A service that
 * was last errored 6 minutes ago is considered recovered, because
 * the operator has had time to act.
 *
 * This function is pure — it does not mutate state.
 */
export function overallHealthy(snapshot: Record<string, ServiceHealth>, recentErrorMs: number = 5 * 60 * 1000, now: number = Date.now()): boolean {
  const services: ServiceHealth[] = Object.values(snapshot);
  for (const s of services) {
    if (!s.expected) continue;
    if (s.lastError !== null && s.lastErrorAt !== null) {
      if (now - s.lastErrorAt <= recentErrorMs) return false;
    }
    // For syslog, "bound" must be true. We can't use the error
    // window for "never bound" — fall through to the lastRunAt check
    // below.
  }
  // Syslog-specific: if expected but never bound, unhealthy.
  const syslog = snapshot['syslog'];
  if (syslog !== undefined && syslog.expected && syslog.bound === false) {
    return false;
  }
  // If a service is expected and has never run, treat as unhealthy.
  // The interval defaults are minutes-to-hours, so a missing
  // lastRunAt means the loop is dead. A stale error without a
  // successful tick is different: after the recent-error window has
  // elapsed, the operator-facing verdict recovers even though
  // detectHangedLoops still reports the missing tick separately.
  for (const s of services) {
    if (!s.expected) continue;
    if (s.lastRunAt === null && s.lastErrorAt === null) return false;
  }
  return true;
}
