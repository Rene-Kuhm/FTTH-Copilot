import { describe, it, expect } from 'vitest';
import { correlateAlerts } from '../src/correlate';
import type { AlertRecord } from '../src/types';

const NOW = new Date('2026-08-21T00:00:00.000Z');

function alert(overrides: Partial<AlertRecord> = {}): AlertRecord {
  return {
    tenantId: 't1',
    connectionId: 'c1',
    kind: 'predicted_low_signal',
    severity: 'warning',
    deviceKind: 'ONU',
    deviceId: 'onu-1',
    title: 't',
    description: 'd',
    status: 'open',
    firstSeenAt: NOW,
    lastSeenAt: NOW,
    lastNotifiedAt: NOW,
    ...overrides,
  };
}

describe('correlateAlerts', () => {
  it('returns an empty list for no alerts', () => {
    expect(correlateAlerts([], { now: NOW })).toEqual([]);
  });

  it('groups multiple distinct kinds on one device into an incident', () => {
    const incidents = correlateAlerts(
      [alert({ kind: 'predicted_low_signal' }), alert({ kind: 'intermittent_connection' })],
      { now: NOW },
    );
    expect(incidents).toHaveLength(1);
    expect(incidents[0]!.deviceKind).toBe('ONU');
    expect(incidents[0]!.deviceId).toBe('onu-1');
    expect(incidents[0]!.severity).toBe('warning');
    expect(incidents[0]!.status).toBe('open');
  });

  it('does not form an incident from a single distinct kind', () => {
    const incidents = correlateAlerts(
      [alert({ kind: 'predicted_low_signal' }), alert({ kind: 'predicted_low_signal', deviceId: 'onu-1' })],
      { now: NOW },
    );
    expect(incidents).toEqual([]);
  });

  it('ignores resolved alerts', () => {
    const incidents = correlateAlerts(
      [
        alert({ kind: 'predicted_low_signal' }),
        alert({ kind: 'intermittent_connection', status: 'resolved' }),
      ],
      { now: NOW },
    );
    expect(incidents).toEqual([]);
  });

  it('uses the max severity and the union of the time span', () => {
    const incidents = correlateAlerts(
      [
        alert({
          kind: 'predicted_low_signal',
          severity: 'warning',
          firstSeenAt: new Date(NOW.getTime() - 1000),
          lastSeenAt: NOW,
        }),
        alert({
          kind: 'frequent_reboots',
          severity: 'critical',
          firstSeenAt: new Date(NOW.getTime() - 5000),
          lastSeenAt: new Date(NOW.getTime() + 1000),
        }),
      ],
      { now: NOW },
    );
    expect(incidents).toHaveLength(1);
    expect(incidents[0]!.severity).toBe('critical');
    expect(incidents[0]!.firstSeenAt).toEqual(new Date(NOW.getTime() - 5000));
    expect(incidents[0]!.lastSeenAt).toEqual(new Date(NOW.getTime() + 1000));
  });

  it('produces one incident per device', () => {
    const incidents = correlateAlerts(
      [
        alert({ deviceId: 'onu-1', kind: 'predicted_low_signal' }),
        alert({ deviceId: 'onu-1', kind: 'intermittent_connection' }),
        alert({ deviceId: 'onu-2', kind: 'predicted_low_signal' }),
        alert({ deviceId: 'onu-2', kind: 'frequent_reboots' }),
      ],
      { now: NOW },
    );
    expect(incidents).toHaveLength(2);
  });

  it('honors a custom minKinds', () => {
    const incidents = correlateAlerts(
      [
        alert({ kind: 'predicted_low_signal' }),
        alert({ kind: 'intermittent_connection' }),
        alert({ kind: 'frequent_reboots' }),
      ],
      { now: NOW, minKinds: 3 },
    );
    expect(incidents).toHaveLength(1);
  });
});
