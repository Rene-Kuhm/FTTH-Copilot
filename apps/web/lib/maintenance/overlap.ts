/**
 * Maintenance-window pure helpers (Roadmap Fase 5 — 5.1 + 5.2).
 *
 * No I/O, no Prisma, no `Date.now()`. Callers pass the existing
 * windows explicitly. The helpers validate shape and detect
 * solapamiento determinista.
 */

export type MaintenanceStatus = 'scheduled' | 'cancelled' | 'completed';

export interface MaintenanceWindowInput {
  /** UTC start, epoch ms. */
  startUtcMs: number;
  /** UTC end, epoch ms (strictly greater than start). */
  endUtcMs: number;
  /** IANA timezone string used for display only. */
  timezone: string;
  /** Scope descriptor — opaque JSON, validated structurally only. */
  scope: { kind: 'tenant' | 'connection' | 'device'; id?: string };
}

export interface MaintenanceWindow extends MaintenanceWindowInput {
  id: string;
  tenantId: string;
  title: string;
  description: string | null;
  status: MaintenanceStatus;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
  cancelledByUserId: string | null;
  cancellationReason: string | null;
}

export class MaintenanceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MaintenanceValidationError';
  }
}

/** Validate the shape of a new maintenance-window input. Pure. */
export function validateMaintenanceInput(input: MaintenanceWindowInput): void {
  if (!Number.isFinite(input.startUtcMs)) {
    throw new MaintenanceValidationError('startUtcMs must be a finite number');
  }
  if (!Number.isFinite(input.endUtcMs)) {
    throw new MaintenanceValidationError('endUtcMs must be a finite number');
  }
  if (input.endUtcMs <= input.startUtcMs) {
    throw new MaintenanceValidationError('endUtcMs must be strictly greater than startUtcMs');
  }
  if (typeof input.timezone !== 'string' || input.timezone.length === 0) {
    throw new MaintenanceValidationError('timezone must be a non-empty string');
  }
  if (input.scope === undefined || input.scope === null) {
    throw new MaintenanceValidationError('scope is required');
  }
  if (!['tenant', 'connection', 'device'].includes(input.scope.kind)) {
    throw new MaintenanceValidationError('scope.kind must be one of tenant|connection|device');
  }
  if ((input.scope.kind === 'connection' || input.scope.kind === 'device') &&
      (typeof input.scope.id !== 'string' || input.scope.id.length === 0)) {
    throw new MaintenanceValidationError('scope.id is required when scope.kind is connection or device');
  }
}

/**
 * Deterministic overlap detector.
 *
 * Two ranges overlap iff `a.start < b.end && b.start < a.end`
 * (half-open intervals, touching boundaries do NOT overlap).
 * Pure: same inputs → same result.
 */
export function rangesOverlap(
  aStartMs: number,
  aEndMs: number,
  bStartMs: number,
  bEndMs: number,
): boolean {
  return aStartMs < bEndMs && bStartMs < aEndMs;
}

/**
 * Detect whether a candidate window overlaps any active window
 * (status !== 'cancelled') of the same tenant. Returns the first
 * overlap found, or null. The list of windows is sorted
 * deterministically by id for stable output.
 */
export function findOverlap(
  candidate: { startUtcMs: number; endUtcMs: number },
  existing: ReadonlyArray<MaintenanceWindow>,
): MaintenanceWindow | null {
  const sorted = [...existing].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const w of sorted) {
    if (w.status === 'cancelled') continue;
    if (
      rangesOverlap(
        candidate.startUtcMs,
        candidate.endUtcMs,
        w.startUtcMs,
        w.endUtcMs,
      )
    ) {
      return w;
    }
  }
  return null;
}

/**
 * True when the given timestamp falls inside any non-cancelled
 * window of the tenant. Used by the notification policy (Fase 5
 * PR #2) to silence events that are expected inside the window.
 * Cancelled windows are excluded — a cancelled window MUST NOT
 * silence anything.
 */
export function isInsideActiveMaintenance(
  whenMs: number,
  windows: ReadonlyArray<MaintenanceWindow>,
): boolean {
  for (const w of windows) {
    if (w.status === 'cancelled') continue;
    if (whenMs >= w.startUtcMs && whenMs < w.endUtcMs) return true;
  }
  return false;
}
