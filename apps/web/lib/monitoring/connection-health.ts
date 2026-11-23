/**
 * Per-connection scheduler health (Roadmap Fase 2 — 2.6).
 *
 * Background:
 *
 * `scheduler-health.ts` tracks per-SERVICE state (polling, firmware,
 * fec, syslog). It answers "is the loop alive?" but not "is the
 * loop alive for THIS connection?". A partial NMS failure — one
 * connection times out while the others poll fine — looks healthy
 * at the service level. The roadmap requires:
 *
 *   2.6 — Verificar salud con casos de recuperación, ausencia de
 *         primera ejecución, ciclo colgado y fallos parciales por
 *         conexión. No asumir que un retorno exitoso del scheduler
 *         implica recolección exitosa de todos los equipos.
 *
 * This module is a small per-connection registry keyed by
 * `(tenantId, connectionId)`. The polling loop reports success/failure
 * per connection after each iteration. `snapshotConnectionHealth`
 * returns a stable snapshot, optionally filtered by tenant; the pure
 * `evaluateConnectionHealth` classifier distinguishes five states:
 *
 *   - `fresh`        — never observed yet (primera ejecución ausente).
 *   - `healthy`      — last tick succeeded recently.
 *   - `stale`        — last tick is too old (ciclo colgado).
 *   - `error`        — last tick errored recently (fallo parcial).
 *   - `recovered`    — last tick succeeded after a recent error.
 *
 * The public `/api/health` route only exposes `aggregateConnectionHealth`
 * (counts per state, no ids or error messages). The per-connection detail
 * is served by the authenticated `/api/connectors` route, scoped to the
 * caller's tenant.
 *
 * These classifications NEVER assert anything about the device.
 * They describe the collector stream per connection, in line with
 * the 2.4 separation between device state and collector state.
 */

export type ConnectionHealthState =
  | 'fresh'
  | 'healthy'
  | 'stale'
  | 'error'
  | 'recovered';

export interface ConnectionHealth {
  tenantId: string;
  connectionId: string;
  state: ConnectionHealthState;
  lastRunAt: number | null;
  lastError: string | null;
  lastErrorAt: number | null;
}

/** Composite key: the same connectionId in two tenants is two independent entries. */
function registryKey(tenantId: string, connectionId: string): string {
  return JSON.stringify([tenantId, connectionId]);
}

const CONNECTION_STATE = new Map<string, ConnectionHealth>();

/** Testing-only helper: clears the per-connection registry. */
export function __resetConnectionHealth(): void {
  CONNECTION_STATE.clear();
}

function getOrCreate(tenantId: string, connectionId: string): ConnectionHealth {
  const key = registryKey(tenantId, connectionId);
  let c = CONNECTION_STATE.get(key);
  if (c === undefined) {
    c = {
      tenantId,
      connectionId,
      state: 'fresh',
      lastRunAt: null,
      lastError: null,
      lastErrorAt: null,
    };
    CONNECTION_STATE.set(key, c);
  }
  return c;
}

/** Record a successful tick for a connection. */
export function recordConnectionSuccess(
  tenantId: string,
  connectionId: string,
  now: number = Date.now(),
): ConnectionHealth {
  const c = getOrCreate(tenantId, connectionId);
  c.state = c.lastErrorAt !== null && now > c.lastErrorAt ? 'recovered' : 'healthy';
  c.lastRunAt = now;
  c.lastError = null;
  c.lastErrorAt = null;
  return c;
}

/** Record a tick error for a connection. Keeps the last-run timestamp intact. */
export function recordConnectionError(
  tenantId: string,
  connectionId: string,
  error: string,
  now: number = Date.now(),
): ConnectionHealth {
  const c = getOrCreate(tenantId, connectionId);
  c.lastError = error;
  c.lastErrorAt = now;
  return c;
}

/**
 * Snapshot of registered connections (deep copy of fields).
 * When `tenantId` is supplied, only that tenant's entries are returned.
 */
export function snapshotConnectionHealth(tenantId?: string): ConnectionHealth[] {
  return Array.from(CONNECTION_STATE.values())
    .filter((c) => tenantId === undefined || c.tenantId === tenantId)
    .map((c) => ({
      tenantId: c.tenantId,
      connectionId: c.connectionId,
      state: c.state,
      lastRunAt: c.lastRunAt,
      lastError: c.lastError,
      lastErrorAt: c.lastErrorAt,
    }));
}

/**
 * Pure classifier: re-evaluates `state` for a single snapshot row
 * given the synthetic clock and the staleness thresholds.
 *
 * Order of evaluation (first match wins):
 *  1. no observations at all → `fresh`
 *  2. no successful tick + recent error → `error`
 *  3. last successful tick happened after an error → `recovered`
 *  4. last error is recent and no later success exists → `error`
 *  5. `lastRunAt` is older than `staleAfterMs` → `stale`
 *  6. otherwise → `healthy`
 *
 * Pure: the same inputs produce the same output.
 */
export function evaluateConnectionHealth(
  c: ConnectionHealth,
  now: number,
  staleAfterMs: number = 10 * 60 * 1000,
  recentErrorMs: number = 5 * 60 * 1000,
): ConnectionHealthState {
  if (c.lastRunAt === null && c.lastError === null && c.lastErrorAt === null) {
    return 'fresh';
  }
  if (c.lastRunAt === null) {
    if (c.lastError !== null && c.lastErrorAt !== null && now - c.lastErrorAt <= recentErrorMs) {
      return 'error';
    }
    return 'fresh';
  }
  if (c.state === 'recovered' && now - c.lastRunAt <= staleAfterMs) return 'recovered';
  if (c.lastErrorAt !== null && c.lastRunAt > c.lastErrorAt) return 'recovered';
  if (c.lastError !== null && c.lastErrorAt !== null) {
    if (now - c.lastErrorAt <= recentErrorMs) return 'error';
  }
  if (now - c.lastRunAt > staleAfterMs) return 'stale';
  // Recovery from externally supplied snapshots that still carry
  // the historical error fields. Registry snapshots use `state`
  // to preserve the same recovered signal after clearing lastError.
  if (
    c.lastError !== null &&
    c.lastErrorAt !== null &&
    now - c.lastErrorAt > recentErrorMs
  ) {
    return 'recovered';
  }
  return 'healthy';
}

/**
 * Apply `evaluateConnectionHealth` to every entry in `snapshotConnectionHealth()`.
 * Pure: given the same registry state and the same `now`, returns the
 * same list. `tenantId` optionally restricts the result to one tenant.
 */
export function snapshotEvaluatedConnectionHealth(
  now: number = Date.now(),
  staleAfterMs: number = 10 * 60 * 1000,
  recentErrorMs: number = 5 * 60 * 1000,
  tenantId?: string,
): ConnectionHealth[] {
  return snapshotConnectionHealth(tenantId).map((c) => ({
    ...c,
    state: evaluateConnectionHealth(c, now, staleAfterMs, recentErrorMs),
  }));
}

/** Counts per state, with every state present even when it has zero entries. */
export type ConnectionHealthCounts = Record<ConnectionHealthState, number>;

export interface ConnectionHealthAggregate {
  total: number;
  byState: ConnectionHealthCounts;
}

/**
 * Non-identifying projection for the public health endpoint. It never
 * carries connection ids, tenant ids or error messages — only counts.
 */
export function aggregateConnectionHealth(
  entries: ConnectionHealth[],
): ConnectionHealthAggregate {
  const byState: ConnectionHealthCounts = {
    fresh: 0,
    healthy: 0,
    stale: 0,
    error: 0,
    recovered: 0,
  };
  for (const entry of entries) byState[entry.state] += 1;
  return { total: entries.length, byState };
}
