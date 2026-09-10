import { describe, expect, it } from 'vitest';
import {
  applyMaintenanceNotificationPolicy,
  SOC_CATEGORIES,
  type MaintenancePolicyInput,
} from '../../../lib/maintenance/notification-policy';
import type { MaintenanceWindow } from '../../../lib/maintenance/overlap';

const NOW = Date.parse('2026-09-10T12:00:00.000Z');

function w(o: Partial<MaintenanceWindow>): MaintenanceWindow {
  return {
    id: o.id ?? 'mw_1',
    tenantId: o.tenantId ?? 't_1',
    title: o.title ?? 'Splice',
    description: o.description ?? null,
    startUtcMs: o.startUtcMs ?? NOW,
    endUtcMs: o.endUtcMs ?? NOW + 60 * 60 * 1000,
    timezone: o.timezone ?? 'UTC',
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

function ev(o: Partial<MaintenancePolicyInput>): MaintenancePolicyInput {
  return {
    severity: o.severity ?? 'warning',
    category: o.category ?? 'metric_anomaly',
    deviceKind: o.deviceKind ?? 'ONU',
    deviceId: o.deviceId ?? 'ONU-1',
    whenMs: o.whenMs ?? NOW + 30 * 60 * 1000,
  };
}

describe('SOC_CATEGORIES (5.4)', () => {
  it('lists the closed SOC set', () => {
    expect(SOC_CATEGORIES).toEqual(['auth_failure', 'access', 'config_change', 'rogue_device']);
  });
});

describe('applyMaintenanceNotificationPolicy — SOC never suppressed (5.4)', () => {
  for (const cat of SOC_CATEGORIES) {
    it(`returns 'never-suppress' for category=${cat}`, () => {
      const r = applyMaintenanceNotificationPolicy({
        event: ev({ category: cat, severity: 'critical' }),
        windows: [w({ scope: { kind: 'tenant' } })],
      });
      expect(r).toBe('never-suppress');
    });
  }

  it('even critical SOC events inside a maintenance window must notify', () => {
    const r = applyMaintenanceNotificationPolicy({
      event: ev({ category: 'auth_failure', severity: 'critical', whenMs: NOW + 30 * 60 * 1000 }),
      windows: [w({ scope: { kind: 'tenant' } })],
    });
    expect(r).toBe('never-suppress');
  });
});

describe('applyMaintenanceNotificationPolicy — default notify (5.3)', () => {
  it('returns notify when no active window covers the event', () => {
    const r = applyMaintenanceNotificationPolicy({
      event: ev({ whenMs: NOW + 5 * 60 * 1000 }),
      windows: [],
    });
    expect(r).toBe('notify');
  });

  it('returns notify when the event is before the window start', () => {
    const r = applyMaintenanceNotificationPolicy({
      event: ev({ whenMs: NOW - 60 * 60 * 1000 }),
      windows: [w({ scope: { kind: 'tenant' } })],
    });
    expect(r).toBe('notify');
  });

  it('returns notify when the event is after the window end', () => {
    const r = applyMaintenanceNotificationPolicy({
      event: ev({ whenMs: NOW + 3 * 60 * 60 * 1000 }),
      windows: [w({ endUtcMs: NOW + 60 * 60 * 1000 })],
    });
    expect(r).toBe('notify');
  });

  it('cancelled windows do NOT suppress events', () => {
    const r = applyMaintenanceNotificationPolicy({
      event: ev({ whenMs: NOW + 30 * 60 * 1000 }),
      windows: [w({ status: 'cancelled' })],
    });
    expect(r).toBe('notify');
  });
});

describe('applyMaintenanceNotificationPolicy — suppress (5.3)', () => {
  it('returns suppress when a tenant-wide window covers the event', () => {
    const r = applyMaintenanceNotificationPolicy({
      event: ev({ whenMs: NOW + 30 * 60 * 1000 }),
      windows: [w({ scope: { kind: 'tenant' } })],
    });
    expect(r).toBe('suppress');
  });

  it('returns notify when only a connection-scoped window exists (semantic mapping missing)', () => {
    // Connection / device scopes MUST NOT silence until the consumer
    // wires up deviceKind → connectionId. Until then, notify.
    const r = applyMaintenanceNotificationPolicy({
      event: ev({ whenMs: NOW + 30 * 60 * 1000 }),
      windows: [w({ scope: { kind: 'connection', id: 'c_X' } })],
    });
    expect(r).toBe('notify');
  });
});

describe('applyMaintenanceNotificationPolicy — purity', () => {
  it('is idempotent — same inputs produce the same decision', () => {
    const args = {
      event: ev({ whenMs: NOW + 30 * 60 * 1000 }),
      windows: [w({ scope: { kind: 'tenant' } })],
    };
    const a = applyMaintenanceNotificationPolicy(args);
    const b = applyMaintenanceNotificationPolicy(args);
    expect(a).toBe(b);
  });
});
