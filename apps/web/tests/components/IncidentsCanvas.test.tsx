// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { incidentImportance, type CanvasIncident } from '../../components/IncidentsCanvas';

function inc(o: Partial<CanvasIncident>): CanvasIncident {
  return {
    id: o.id ?? 'inc-1',
    deviceKind: o.deviceKind ?? 'ONU',
    deviceId: o.deviceId ?? 'ONU-1',
    title: o.title ?? 'Test',
    description: o.description ?? '',
    severity: o.severity ?? 'warning',
    status: o.status ?? 'open',
    firstSeenAt: o.firstSeenAt ?? '2026-09-10T10:00:00.000Z',
    lastSeenAt: o.lastSeenAt ?? '2026-09-10T10:00:00.000Z',
    alertCount: o.alertCount ?? 1,
  };
}

describe('incidentImportance — severity + status matrix', () => {
  it('critical + open = 5 (highest)', () => {
    expect(incidentImportance(inc({ severity: 'critical', status: 'open' }))).toBe(5);
  });

  it('critical + acknowledged = 4', () => {
    expect(incidentImportance(inc({ severity: 'critical', status: 'acknowledged' }))).toBe(4);
  });

  it('critical + resolved = 4 (severity wins over status)', () => {
    expect(incidentImportance(inc({ severity: 'critical', status: 'resolved' }))).toBe(4);
  });

  it('warning + open = 3', () => {
    expect(incidentImportance(inc({ severity: 'warning', status: 'open' }))).toBe(3);
  });

  it('warning + acknowledged = 2', () => {
    expect(incidentImportance(inc({ severity: 'warning', status: 'acknowledged' }))).toBe(2);
  });

  it('warning + resolved = 1', () => {
    expect(incidentImportance(inc({ severity: 'warning', status: 'resolved' }))).toBe(1);
  });

  it('is pure — same input yields the same importance', () => {
    const i = inc({ severity: 'critical', status: 'open' });
    expect(incidentImportance(i)).toBe(incidentImportance(i));
  });

  it('always returns a value in [1, 5]', () => {
    for (const s of ['warning', 'critical'] as const) {
      for (const st of ['open', 'acknowledged', 'resolved'] as const) {
        const r = incidentImportance(inc({ severity: s, status: st }));
        expect(r).toBeGreaterThanOrEqual(1);
        expect(r).toBeLessThanOrEqual(5);
      }
    }
  });
});
