import { describe, it, expect } from 'vitest';
import { reconcile, findingKey } from '../src/dedup';
import type { Finding } from '@ftth-copilot/detection';
import type { AlertRecord } from '../src/types';

const NOW = new Date('2026-08-21T00:00:00.000Z');

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'predicted-low-signal-ONU-onu-1',
    kind: 'predicted_low_signal',
    severity: 'warning',
    deviceKind: 'ONU',
    deviceId: 'onu-1',
    title: 'Señal en caída: onu-1',
    description: 'desc',
    etaMs: 86400000,
    confidence: 1,
    detectedAt: NOW.toISOString(),
    ...overrides,
  };
}

function alert(overrides: Partial<AlertRecord> = {}): AlertRecord {
  return {
    id: 'a1',
    tenantId: 't1',
    connectionId: 'c1',
    kind: 'predicted_low_signal',
    severity: 'warning',
    deviceKind: 'ONU',
    deviceId: 'onu-1',
    title: 'Señal en caída: onu-1',
    description: 'desc',
    etaMs: 86400000,
    confidence: 1,
    status: 'open',
    firstSeenAt: new Date(NOW.getTime() - 1000),
    lastSeenAt: new Date(NOW.getTime() - 1000),
    lastNotifiedAt: new Date(NOW.getTime() - 1000),
    ...overrides,
  };
}

const META = { tenantId: 't1', connectionId: 'c1' };
const COOLDOWN = 60 * 60 * 1000;

describe('reconcile', () => {
  it('creates and notifies a new alert', () => {
    const { toUpsert, toNotify } = reconcile([finding()], new Map(), META, { now: NOW, cooldownMs: COOLDOWN });
    expect(toUpsert).toHaveLength(1);
    expect(toNotify).toHaveLength(1);
    expect(toUpsert[0]!.status).toBe('open');
    expect(toUpsert[0]!.lastNotifiedAt).toEqual(NOW);
  });

  it('does not notify within the cooldown window', () => {
    const existing = new Map([[findingKey(finding()), alert()]]);
    const { toUpsert, toNotify } = reconcile([finding()], existing, META, { now: NOW, cooldownMs: COOLDOWN });
    expect(toUpsert).toHaveLength(1);
    expect(toNotify).toHaveLength(0);
    expect(toUpsert[0]!.lastSeenAt).toEqual(NOW);
  });

  it('notifies again after the cooldown elapses', () => {
    const existing = new Map([
      [findingKey(finding()), alert({ lastNotifiedAt: new Date(NOW.getTime() - 2 * COOLDOWN) })],
    ]);
    const { toUpsert, toNotify } = reconcile([finding()], existing, META, { now: NOW, cooldownMs: COOLDOWN });
    expect(toNotify).toHaveLength(1);
    expect(toUpsert[0]!.lastNotifiedAt).toEqual(NOW);
  });

  it('escalates warning to critical and notifies immediately', () => {
    const existing = new Map([[findingKey(finding()), alert({ severity: 'warning' })]]);
    const { toUpsert, toNotify } = reconcile(
      [finding({ severity: 'critical' })],
      existing,
      META,
      { now: NOW, cooldownMs: COOLDOWN },
    );
    expect(toUpsert[0]!.severity).toBe('critical');
    expect(toNotify).toHaveLength(1);
  });

  it('notifies when the alert has never been notified before', () => {
    const existing = new Map([[findingKey(finding()), alert({ lastNotifiedAt: null })]]);
    const { toUpsert, toNotify } = reconcile([finding()], existing, META, {
      now: NOW,
      cooldownMs: COOLDOWN,
    });
    expect(toNotify).toHaveLength(1);
    expect(toUpsert[0]!.lastNotifiedAt).toEqual(NOW);
  });

  it('never downgrades severity', () => {
    const existing = new Map([[findingKey(finding()), alert({ severity: 'critical' })]]);
    const { toUpsert } = reconcile([finding({ severity: 'warning' })], existing, META, {
      now: NOW,
      cooldownMs: COOLDOWN,
    });
    expect(toUpsert[0]!.severity).toBe('critical');
  });

  it('returns empty results when there are no findings', () => {
    const { toUpsert, toNotify } = reconcile([], new Map(), META, { now: NOW, cooldownMs: COOLDOWN });
    expect(toUpsert).toEqual([]);
    expect(toNotify).toEqual([]);
  });
});
