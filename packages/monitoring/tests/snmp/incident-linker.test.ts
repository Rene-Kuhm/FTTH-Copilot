import { describe, expect, it } from 'vitest';
import type { TelemetryEvent } from '@ftth-copilot/shared';
import {
  correlateTrapWithIncidents,
  type ActiveIncidentContext,
  type CorrelateTrapArgs,
} from '../../src/snmp/incident-linker';

describe('SNMP Incident Linker & Recovery (Roadmap Fase 6 — 6.6)', () => {
  const openIncident: ActiveIncidentContext = {
    id: 'inc-101',
    tenantId: 'tenant-1',
    deviceKind: 'ONU',
    deviceId: 'ONU-001',
    status: 'open',
    firstSeenAt: '2026-09-10T10:00:00.000Z',
    lastSeenAt: '2026-09-10T10:05:00.000Z',
  };

  function makeTrap(partial: Partial<TelemetryEvent>): TelemetryEvent {
    return {
      schema: 'ftth.telemetry.v1',
      tenantId: 'tenant-1',
      deviceKind: 'ONU',
      deviceId: 'ONU-001',
      source: 'snmp-trap',
      ts: '2026-09-10T10:06:00.000Z',
      metrics: {
        trapCategory: 'dying_gasp',
        snmpTrapOid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.2',
      },
      ...partial,
    };
  }

  it('correlates incoming alarm trap with matching open incident and advances lastSeenAt', () => {
    const trap = makeTrap({ ts: '2026-09-10T10:07:00.000Z' });
    const outcome = correlateTrapWithIncidents({
      event: trap,
      activeIncidents: [openIncident],
    });

    expect(outcome.action).toBe('correlate_alarm');
    expect(outcome.incidentId).toBe('inc-101');
    expect(outcome.updatedLastSeenAt).toBe('2026-09-10T10:07:00.000Z');
  });

  it('marks incident as recovered when a link_up trap arrives after incident observation', () => {
    const recoveryTrap = makeTrap({
      ts: '2026-09-10T10:10:00.000Z',
      metrics: {
        trapCategory: 'link_up',
        snmpTrapOid: '1.3.6.1.6.3.1.1.5.4',
      },
    });

    const outcome = correlateTrapWithIncidents({
      event: recoveryTrap,
      activeIncidents: [openIncident],
    });

    expect(outcome.action).toBe('mark_recovered');
    expect(outcome.incidentId).toBe('inc-101');
    expect(outcome.recoveryAt).toBe('2026-09-10T10:10:00.000Z');
  });

  it('discards stale out-of-order alarm trap whose timestamp is prior to lastSeenAt', () => {
    // Incident was observed up to 10:05:00.000Z.
    // An out-of-order UDP datagram arrives timestamped 10:02:00.000Z.
    const staleTrap = makeTrap({ ts: '2026-09-10T10:02:00.000Z' });
    const outcome = correlateTrapWithIncidents({
      event: staleTrap,
      activeIncidents: [openIncident],
    });

    expect(outcome.action).toBe('discard_stale');
    expect(outcome.incidentId).toBe('inc-101');
    expect(outcome.reason).toMatch(/out-of-order/i);
  });

  it('returns no_match when incident belongs to another tenant (strict isolation)', () => {
    const trapTenant2 = makeTrap({
      tenantId: 'tenant-2',
      ts: '2026-09-10T10:07:00.000Z',
    });

    const outcome = correlateTrapWithIncidents({
      event: trapTenant2,
      activeIncidents: [openIncident], // tenant-1
    });

    expect(outcome.action).toBe('no_match');
    expect(outcome.incidentId).toBeUndefined();
  });

  it('discards stale out-of-order recovery trap predating incident observation', () => {
    const staleRecoveryTrap = makeTrap({
      ts: '2026-09-10T10:03:00.000Z',
      metrics: {
        trapCategory: 'link_up',
        snmpTrapOid: '1.3.6.1.6.3.1.1.5.4',
      },
    });

    const outcome = correlateTrapWithIncidents({
      event: staleRecoveryTrap,
      activeIncidents: [openIncident],
    });

    expect(outcome.action).toBe('discard_stale');
    expect(outcome.incidentId).toBe('inc-101');
    expect(outcome.reason).toMatch(/predates active incident/i);
  });

  it('allows traps within clock skew tolerance window', () => {
    // Incident last seen at 10:05:00.000Z. Trap at 10:04:55.000Z (5s drift).
    const driftTrap = makeTrap({ ts: '2026-09-10T10:04:55.000Z' });
    const outcome = correlateTrapWithIncidents({
      event: driftTrap,
      activeIncidents: [openIncident],
      clockSkewToleranceMs: 10_000, // 10s tolerance
    });

    expect(outcome.action).toBe('correlate_alarm');
    expect(outcome.incidentId).toBe('inc-101');
  });

  it('ignores resolved incidents and returns no_match', () => {
    const resolvedIncident: ActiveIncidentContext = {
      ...openIncident,
      status: 'resolved',
      resolvedAt: '2026-09-10T10:06:00.000Z',
    };

    const trap = makeTrap({ ts: '2026-09-10T10:07:00.000Z' });
    const outcome = correlateTrapWithIncidents({
      event: trap,
      activeIncidents: [resolvedIncident],
    });

    expect(outcome.action).toBe('no_match');
  });
});
