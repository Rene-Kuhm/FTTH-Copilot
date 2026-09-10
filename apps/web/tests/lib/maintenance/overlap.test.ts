import { describe, expect, it } from 'vitest';
import {
  findOverlap,
  isInsideActiveMaintenance,
  MaintenanceValidationError,
  rangesOverlap,
  validateMaintenanceInput,
  type MaintenanceWindow,
} from '../../../lib/maintenance/overlap';

const NOW = Date.parse('2026-09-10T12:00:00.000Z');

function w(o: Partial<MaintenanceWindow>): MaintenanceWindow {
  return {
    id: o.id ?? 'mw_' + Math.random().toString(36).slice(2, 8),
    tenantId: o.tenantId ?? 't_1',
    title: o.title ?? 'Test',
    description: o.description ?? null,
    startUtcMs: o.startUtcMs ?? NOW,
    endUtcMs: o.endUtcMs ?? NOW + 60 * 60 * 1000,
    timezone: o.timezone ?? 'America/Argentina/Buenos_Aires',
    scope: o.scope ?? { kind: 'tenant' },
    status: o.status ?? 'scheduled',
    createdByUserId: o.createdByUserId ?? 'u_1',
    createdAt: o.createdAt ?? '2026-09-10T11:00:00.000Z',
    updatedAt: o.updatedAt ?? '2026-09-10T11:00:00.000Z',
    cancelledAt: o.cancelledAt ?? null,
    cancelledByUserId: o.cancelledByUserId ?? null,
    cancellationReason: o.cancellationReason ?? null,
  };
}

describe('validateMaintenanceInput (5.1)', () => {
  it('accepts a valid input', () => {
    expect(() =>
      validateMaintenanceInput({
        startUtcMs: NOW,
        endUtcMs: NOW + 1000,
        timezone: 'UTC',
        scope: { kind: 'tenant' },
      }),
    ).not.toThrow();
  });

  it('rejects endUtcMs <= startUtcMs', () => {
    expect(() =>
      validateMaintenanceInput({
        startUtcMs: NOW,
        endUtcMs: NOW,
        timezone: 'UTC',
        scope: { kind: 'tenant' },
      }),
    ).toThrow(MaintenanceValidationError);
  });

  it('rejects an empty timezone', () => {
    expect(() =>
      validateMaintenanceInput({
        startUtcMs: NOW,
        endUtcMs: NOW + 1000,
        timezone: '',
        scope: { kind: 'tenant' },
      }),
    ).toThrow(MaintenanceValidationError);
  });

  it('rejects connection scope without id', () => {
    expect(() =>
      validateMaintenanceInput({
        startUtcMs: NOW,
        endUtcMs: NOW + 1000,
        timezone: 'UTC',
        scope: { kind: 'connection' },
      }),
    ).toThrow(MaintenanceValidationError);
  });

  it('rejects unknown scope kind', () => {
    expect(() =>
      validateMaintenanceInput({
        startUtcMs: NOW,
        endUtcMs: NOW + 1000,
        timezone: 'UTC',
        scope: { kind: 'region' as 'tenant' },
      }),
    ).toThrow(MaintenanceValidationError);
  });
});

describe('rangesOverlap — pure (5.2)', () => {
  it('detects strict overlap', () => {
    expect(rangesOverlap(0, 100, 50, 150)).toBe(true);
    expect(rangesOverlap(50, 150, 0, 100)).toBe(true);
  });

  it('does NOT overlap when ranges touch at the boundary', () => {
    // Half-open: [0,100) and [100,200) do not overlap.
    expect(rangesOverlap(0, 100, 100, 200)).toBe(false);
    expect(rangesOverlap(100, 200, 0, 100)).toBe(false);
  });

  it('does NOT overlap when ranges are disjoint', () => {
    expect(rangesOverlap(0, 50, 100, 200)).toBe(false);
  });
});

describe('findOverlap (5.2 — deterministic overlap detector)', () => {
  it('returns the first non-cancelled window that overlaps', () => {
    const existing = [
      w({ id: 'mw_1', startUtcMs: NOW, endUtcMs: NOW + 1000 }),
      w({ id: 'mw_2', startUtcMs: NOW + 2000, endUtcMs: NOW + 3000 }),
    ];
    const overlap = findOverlap(
      { startUtcMs: NOW + 500, endUtcMs: NOW + 2500 },
      existing,
    );
    expect(overlap?.id).toBe('mw_1');
  });

  it('ignores cancelled windows', () => {
    const existing = [
      w({ id: 'mw_1', startUtcMs: NOW, endUtcMs: NOW + 1000, status: 'cancelled' }),
      w({ id: 'mw_2', startUtcMs: NOW + 2000, endUtcMs: NOW + 3000 }),
    ];
    const overlap = findOverlap(
      { startUtcMs: NOW + 500, endUtcMs: NOW + 1500 },
      existing,
    );
    expect(overlap).toBeNull();
  });

  it('returns null for non-overlapping candidate', () => {
    const existing = [
      w({ id: 'mw_1', startUtcMs: NOW, endUtcMs: NOW + 1000 }),
    ];
    const overlap = findOverlap(
      { startUtcMs: NOW + 5000, endUtcMs: NOW + 6000 },
      existing,
    );
    expect(overlap).toBeNull();
  });

  it('is deterministic — same inputs produce the same overlap', () => {
    const existing = [
      w({ id: 'mw_B', startUtcMs: NOW, endUtcMs: NOW + 1000 }),
      w({ id: 'mw_A', startUtcMs: NOW, endUtcMs: NOW + 1000 }),
    ];
    const a = findOverlap({ startUtcMs: NOW + 100, endUtcMs: NOW + 200 }, existing);
    const b = findOverlap({ startUtcMs: NOW + 100, endUtcMs: NOW + 200 }, existing);
    expect(a?.id).toBe(b?.id);
  });
});

describe('isInsideActiveMaintenance (5.4 helper)', () => {
  it('returns true when the timestamp falls inside an active window', () => {
    const existing = [w({ startUtcMs: NOW, endUtcMs: NOW + 1000 })];
    expect(isInsideActiveMaintenance(NOW + 500, existing)).toBe(true);
  });

  it('returns false when the timestamp falls outside any window', () => {
    const existing = [w({ startUtcMs: NOW, endUtcMs: NOW + 1000 })];
    expect(isInsideActiveMaintenance(NOW + 2000, existing)).toBe(false);
  });

  it('cancelled windows MUST NOT silence events', () => {
    const existing = [
      w({ startUtcMs: NOW, endUtcMs: NOW + 1000, status: 'cancelled' }),
    ];
    expect(isInsideActiveMaintenance(NOW + 500, existing)).toBe(false);
  });
});
