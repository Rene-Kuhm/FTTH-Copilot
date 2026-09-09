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
 * This module is a small per-connection registry. The polling loop
 * reports success/failure per `connectionId` after each iteration.
 * `snapshotConnectionHealth` returns a stable snapshot for the
 * `/api/health` route, and the pure `evaluateConnectionHealth`
 * classifier distinguishes four states:
 *
 *   - `fresh`        — never observed yet (primera ejecución ausente).
 *   - `healthy`      — last tick succeeded recently.
 *   - `stale`        — last tick is too old (ciclo colgado).
 *   - `error`        — last tick errored recently (fallo parcial).
 *   - `recovered`    — last tick succeeded after a recent error.
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
  connectionId: string;
  state: ConnectionHealthState;
  lastRunAt: number | null;
  lastError: string | null;
  lastErrorAt: number | null;
}

const CONNECTION_STATE = new Map<string, ConnectionHealth>();

/** Testing-only helper: clears the per-connection registry. */
export function __resetConnectionHealth(): void {
  CONNECTION_STATE.clear();
}

function getOrCreate(connectionId: string): ConnectionHealth {
  let c = CONNECTION_STATE.get(connectionId);
  if (c === undefined) {
    c = {
      connectionId,
      state: 'fresh',
      lastRunAt: null,
      lastError: null,
      lastErrorAt: null,
    };
    CONNECTION_STATE.set(connectionId, c);
  }
  return c;
}

/** Record a successful tick for a connection. */
export function recordConnectionSuccess(
  connectionId: string,
  now: number = Date.now(),
): ConnectionHealth {
  const c = getOrCreate(connectionId);
  c.lastRunAt = now;
  c.lastError = null;
  c.lastErrorAt = null;
  return c;
}

/** Record a tick error for a connection. Keeps the last-run timestamp intact. */
export function recordConnectionError(
  connectionId: string,
  error: string,
  now: number = Date.now(),
): ConnectionHealth {
  const c = getOrCreate(connectionId);
  c.lastError = error;
  c.lastErrorAt = now;
  return c;
}

/** Snapshot of all registered connections (deep copy of fields). */
export function snapshotConnectionHealth(): ConnectionHealth[] {
  return Array.from(CONNECTION_STATE.values()).map((c) => ({
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
 *  1. no `lastRunAt` and no `lastError` → `fresh`
 *  2. `lastError` is recent (within `recentErrorMs`) → `error`
 *  3. `lastRunAt` is older than `staleAfterMs` → `stale`
 *  4. last tick was a success after a recent error → `recovered`
 *  5. otherwise → `healthy`
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
  if (c.lastError !== null && c.lastErrorAt !== null) {
    if (now - c.lastErrorAt <= recentErrorMs) return 'error';
  }
  if (c.lastRunAt === null) return 'fresh';
  if (now - c.lastRunAt > staleAfterMs) return 'stale';
  // Recovery: we have an error timestamp older than the window AND
  // a recent successful run. The snapshot keeps `lastError` set
  // until the next `recordConnectionSuccess`, so callers can see
  // the historical error.
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
 * same list.
 */
export function snapshotEvaluatedConnectionHealth(
  now: number = Date.now(),
  staleAfterMs: number = 10 * 60 * 1000,
  recentErrorMs: number = 5 * 60 * 1000,
): ConnectionHealth[] {
  return snapshotConnectionHealth().map((c) => ({
    ...c,
    state: evaluateConnectionHealth(c, now, staleAfterMs, recentErrorMs),
  }));
}
