import { describe, expect, it } from 'vitest';
import { executeAdapterSafe } from '../../src/snmp/adapter/contract';
import { FiberhomeOltAdapter } from '../../src/snmp/adapter/fiberhome';
import type { ResolvedDeviceIdentity } from '../../src/snmp/identity';
import type { DecodedSnmpNotification, RawSnmpEvidenceEnvelope } from '../../src/snmp/types';

describe('FiberHome OLT Adapter (Roadmap Fase 4)', () => {
  const mockIdentity: ResolvedDeviceIdentity = {
    tenantId: 'tenant-acme',
    connectionId: 'conn-fiberhome-01',
    oltId: 'fh-an5516-central',
    vendor: 'FiberHome',
    pen: 3807,
    isStandardTrap: false,
    isAmbiguous: false,
  };

  const mockEvidence: RawSnmpEvidenceEnvelope = {
    evidenceId: 'ev-fh-1',
    receivedAt: '2026-09-10T12:00:00.000Z',
    senderIp: '10.100.4.10',
    senderPort: 162,
    snmpVersion: 'v2c',
    pduType: 'TrapV2',
    trapOid: '1.3.6.1.4.1.3807.1.3.1.1.1.3.1.8',
    sysUpTime: 412000,
    eventTime: null,
    varbinds: [],
    credentialsRedacted: true,
    fingerprint: 'mock-fh-fingerprint',
  };

  const adapter = new FiberhomeOltAdapter();

  it('supports FiberHome identity, PEN 3807, and FiberHome OIDs, rejecting ambiguous identities', () => {
    const notification: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.4.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.3807.1.3.1.1.1',
      receivedAtMs: 1773316800000,
      varbinds: [],
    };

    expect(adapter.supports(notification, mockIdentity)).toBe(true);

    const ambiguousIdentity: ResolvedDeviceIdentity = {
      ...mockIdentity,
      isAmbiguous: true,
      ambiguityReason: 'Sender mismatch',
    };
    expect(adapter.supports(notification, ambiguousIdentity)).toBe(false);
  });

  it('extracts hierarchy (slot/port/onuId) and serial from instance suffix and varbinds', () => {
    const notification: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.4.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.3807.1.3.1.1.1.3.1.8', // LOS with slot 3, port 1, onu 8
      receivedAtMs: 1773316800000,
      varbinds: [
        {
          oid: '1.3.6.1.4.1.3807.1.3.1.1.2.1',
          type: 'OctetString',
          value: 'FHTT87654321',
        },
      ],
    };

    const event = executeAdapterSafe(adapter, notification, mockIdentity, mockEvidence);

    expect(event.schema).toBe('ftth.telemetry.v1');
    expect(event.tenantId).toBe('tenant-acme');
    expect(event.deviceKind).toBe('ONU');
    expect(event.deviceId).toBe('FHTT87654321');
    expect(event.metrics.slot).toBe(3);
    expect(event.metrics.port).toBe(1);
    expect(event.metrics.onuId).toBe(8);
    expect(event.metrics.serial).toBe('FHTT87654321');
    expect(event.metrics.severity).toBe('critical');
    expect(event.tags?.['serial']).toBe('FHTT87654321');
    expect(event.tags?.['adapter']).toBe('fiberhome');
  });

  it('decodes hex-encoded serial number octet strings with FHTT prefix without mangling', () => {
    const notification: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.4.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.3807.1.3.1.1.2.2.4.12', // Dying gasp: slot 2, port 4, onu 12
      receivedAtMs: 1773316800000,
      varbinds: [
        {
          oid: '1.3.6.1.4.1.3807.1.3.1.1.2.1',
          type: 'OctetString',
          value: '',
          rawHex: '464854543132333435363738', // FHTT12345678
        },
      ],
    };

    const event = executeAdapterSafe(adapter, notification, mockIdentity, mockEvidence);

    expect(event.deviceKind).toBe('ONU');
    expect(event.deviceId).toBe('FHTT12345678');
    expect(event.metrics.slot).toBe(2);
    expect(event.metrics.port).toBe(4);
    expect(event.metrics.onuId).toBe(12);
    expect(event.metrics.serial).toBe('FHTT12345678');
    expect(event.metrics.trapCategory).toBe('dying_gasp');
  });

  it('recognizes recovery clear traps (fhGponOntOnline) with isClear: true and cleared category', () => {
    const notification: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.4.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.3807.1.3.1.1.4.3.1.8', // Online clear
      receivedAtMs: 1773316800000,
      varbinds: [
        {
          oid: '1.3.6.1.4.1.3807.1.3.1.1.2.1',
          type: 'OctetString',
          value: 'FHTT87654321',
        },
      ],
    };

    const event = executeAdapterSafe(adapter, notification, mockIdentity, mockEvidence);

    expect(event.deviceKind).toBe('ONU');
    expect(event.metrics.isClear).toBe(true);
    expect(event.metrics.clearsCategory).toBe('onu_offline');
    expect(event.metrics.severity).toBe('info');
  });

  it('scopes port-level traps (fhGponPortDown) to OLT without inventing ONU identity', () => {
    const notification: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.4.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.3807.1.3.1.2.1.3.1', // Port down: slot 3, port 1
      receivedAtMs: 1773316800000,
      varbinds: [],
    };

    const event = executeAdapterSafe(adapter, notification, mockIdentity, mockEvidence);

    expect(event.deviceKind).toBe('OLT');
    expect(event.deviceId).toBe('fh-an5516-central');
    expect(event.metrics.slot).toBe(3);
    expect(event.metrics.port).toBe(1);
    expect(event.metrics.onuId).toBeUndefined();
    expect(event.metrics.trapCategory).toBe('pon_down');
  });

  it('handles FiberHome board/card failure (fhCardFailure) scoped to OLT', () => {
    const notification: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.4.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.3807.1.1.1.1.1.4', // Card fault subrack 1, slot 4
      receivedAtMs: 1773316800000,
      varbinds: [],
    };

    const event = executeAdapterSafe(adapter, notification, mockIdentity, mockEvidence);

    expect(event.deviceKind).toBe('OLT');
    expect(event.deviceId).toBe('fh-an5516-central');
    expect(event.metrics.subrack).toBe(1);
    expect(event.metrics.slot).toBe(4);
    expect(event.metrics.trapCategory).toBe('card_failure');
  });
});
