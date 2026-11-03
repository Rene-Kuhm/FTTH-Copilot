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
 *   - `nextRunAt`    — epoch ms of the next tick the service is expected to
 *                       produce, or null when it is not known.
 *   - `intervalMs`   — period of the loop, when it is known.
 */

export type SchedulerName = 'polling' | 'firmware' | 'fec' | 'syslog' | 'syslog-detection' | 'snmp';

export interface ServiceHealth {
  expected: boolean;
  lastRunAt: number | null;
  lastError: string | null;
  lastErrorAt: number | null;
  bound?: boolean;
  /**
   * Epoch ms of the next tick this service is expected to produce.
   *
   * It is what separates a loop *warming up* from a loop *hung*: the
   * registry starts empty on every boot, so a worker that just came up has
   * loops that never ran yet. Without a deadline, "never ran" can only mean
   * "dead" — and the health of the whole system would stay degraded until
   * the first tick, which for the firmware is 24 h away.
   *
   * The deadline belongs to the schedule, not to this process: whoever owns
   * the schedule publishes it, and it advances with the schedule.
   */
  nextRunAt?: number | null;
  /**
   * Period of the loop, in milliseconds.
   *
   * Known for the loops that run on a schedule. It lets a consumer tell a
   * slow loop from a dead one without guessing.
   */
  intervalMs?: number | null;
}

/**
 * How long a loop may miss its expected tick before it counts as hung.
 *
 * The tick is delivered by the queue, not by a clock: it can arrive a few
 * seconds late without anything being wrong. The grace covers that delay
 * and the time it takes the owner of the schedule to publish a new deadline.
 */
export const TICK_GRACE_MS = 60_000;

/**
 * The cadence of a loop: how often it ticks and when it ticks next.
 *
 * Optional on purpose: a service that does not tick on a schedule (a
 * receiver) has no cadence, and neither has a loop whose schedule is not
 * known yet.
 */
export interface LoopCadence {
  /** Period of the loop, in milliseconds. */
  intervalMs?: number;
  /** Epoch ms of the next expected tick, or null when it is not known. */
  nextRunAt?: number | null;
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

/** Applies the cadence that the owner of the schedule published. */
function applyCadence(s: ServiceHealth, cadence: LoopCadence): void {
  if (cadence.intervalMs !== undefined) s.intervalMs = cadence.intervalMs;
  if (cadence.nextRunAt !== undefined) s.nextRunAt = cadence.nextRunAt;
}

/**
 * Mark a service as configured to run (env flag enabled).
 *
 * The optional cadence is what the owner of the schedule knows and this
 * registry does not: how often the loop ticks and when it ticks next.
 */
export function markExpected(name: SchedulerName, cadence?: LoopCadence): ServiceHealth {
  const s = getOrCreate(name, true);
  if (cadence) applyCadence(s, cadence);
  return s;
}

/** Mark a service as not configured to run (env flag disabled). */
export function markNotExpected(name: SchedulerName): ServiceHealth {
  return getOrCreate(name, false);
}

/**
 * Publishes when the next tick of a service is expected.
 *
 * The deadline belongs to the schedule: it moves forward on its own as the
 * schedule produces its ticks, and the owner of the schedule is the one
 * that can read it. The registry only holds it.
 */
export function setNextRun(name: SchedulerName, nextRunAt: number | null): void {
  const s = getOrCreate(name, STATE.get(name)?.expected ?? false);
  s.nextRunAt = nextRunAt;
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

/** Record that the SNMP UDP socket bound successfully. */
export function recordSnmpBound(bound: boolean): void {
  const s = getOrCreate('snmp', STATE.get('snmp')?.expected ?? false);
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
 * Whether a service is a receiver and not a loop.
 *
 * The syslog and SNMP receivers hold a UDP socket and do not tick: there is
 * no last run to judge them by. Their health is whether the socket is bound,
 * and a receiver judged by its clock would be reported as hung forever —
 * which would leave the health of the whole system degraded for good.
 */
function isReceiver(service: ServiceHealth): boolean {
  return service.bound !== undefined;
}

/**
 * Per-service "is the loop hung?" check (Fase 2 — 2.6).
 *
 * A loop is considered hung when the tick it was expected to produce did
 * not arrive. Returns the list of services that are expected AND missed
 * that tick. Pure: same snapshot → same list.
 *
 * Two ways to know what was expected:
 *
 *   - The service publishes a deadline (`nextRunAt`): the tick was due at
 *     that instant, and it is hung when it did not arrive. This is the case
 *     of the loops that run on a schedule, and it is what keeps a worker
 *     that just booted from reporting its own loops as dead.
 *   - The service has no deadline: the fallback is the age of its last
 *     tick, with a fixed threshold.
 */
export function detectHangedLoops(
  snapshot: Record<string, ServiceHealth>,
  now: number,
  staleAfterMs: number = 10 * 60 * 1000,
): SchedulerName[] {
  const out: SchedulerName[] = [];
  for (const [name, s] of Object.entries(snapshot) as Array<[SchedulerName, ServiceHealth]>) {
    if (!s.expected) continue;
    // A receiver has no tick: it is watched by its socket, not by a clock.
    if (isReceiver(s)) continue;
    const deadline = s.nextRunAt;
    if (deadline !== undefined && deadline !== null) {
      // The schedule says when the tick was due. Missing it — and only
      // missing it — is what makes the loop hung.
      if (now > deadline + TICK_GRACE_MS) out.push(name);
      continue;
    }
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
  }
  // If a service is expected and has never run, it is unhealthy — unless
  // it published the deadline of the tick it is waiting for. The interval
  // defaults are minutes-to-hours, so a missing lastRunAt usually means the
  // loop is dead; but a worker that just booted has no tick yet, and its
  // loops are warming up, not dead. A stale error without a successful
  // tick is different: after the recent-error window has elapsed, the
  // operator-facing verdict recovers even though detectHangedLoops still
  // reports the missing tick separately.
  for (const s of services) {
    if (!s.expected) continue;
    // A receiver does not tick: its socket is the whole of its health.
    // Judged by its clock, a bound receiver would be unhealthy forever.
    if (isReceiver(s)) {
      if (s.bound !== true) return false;
      continue;
    }
    if (s.lastRunAt === null && s.lastErrorAt === null) {
      // Never ran and never failed. It is only a degradation when the tick
      // it was waiting for did not arrive: a loop that publishes its
      // deadline is warming up, not dead.
      const deadline = s.nextRunAt;
      if (deadline === undefined || deadline === null) return false;
      if (now > deadline + TICK_GRACE_MS) return false;
    }
  }
  return true;
}
