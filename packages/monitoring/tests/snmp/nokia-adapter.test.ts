import { describe, expect, it } from 'vitest';
import { executeAdapterSafe } from '../../src/snmp/adapter/contract';
import { NokiaOltAdapter } from '../../src/snmp/adapter/nokia';
import type { ResolvedDeviceIdentity } from '../../src/snmp/identity';
import type { DecodedSnmpNotification, RawSnmpEvidenceEnvelope } from '../../src/snmp/types';

describe('Nokia / Alcatel-Lucent OLT Adapter (Roadmap Fase 4)', () => {
  const mockIdentity: ResolvedDeviceIdentity = {
    tenantId: 'tenant-acme',
    connectionId: 'conn-nokia-01',
    oltId: 'nokia-7360-central',
    vendor: 'Nokia',
    pen: 637,
    isStandardTrap: false,
    isAmbiguous: false,
  };

  const mockEvidence: RawSnmpEvidenceEnvelope = {
    evidenceId: 'ev-nokia-1',
    receivedAt: '2026-09-10T12:00:00.000Z',
    senderIp: '10.100.3.10',
    senderPort: 162,
    snmpVersion: 'v2c',
    pduType: 'TrapV2',
    trapOid: '1.3.6.1.4.1.637.61.1.36.1.1.1.1.1.2.4.10',
    sysUpTime: 512000,
    eventTime: null,
    varbinds: [],
    credentialsRedacted: true,
    fingerprint: 'mock-nokia-fingerprint',
  };

  const adapter = new NokiaOltAdapter();

  it('supports Nokia/Alcatel identity, PENs (637, 6527, 28458), and Nokia OIDs, rejecting ambiguous identities', () => {
    const notification: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.3.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.637.61.1.36.1.1.1',
      receivedAtMs: 1773316800000,
      varbinds: [],
    };

    expect(adapter.supports(notification, mockIdentity)).toBe(true);

    const timetraIdentity: ResolvedDeviceIdentity = {
      ...mockIdentity,
      vendor: 'Alcatel-Lucent',
      pen: 6527,
    };
    expect(adapter.supports(notification, timetraIdentity)).toBe(true);

    const ambiguousIdentity: ResolvedDeviceIdentity = {
      ...mockIdentity,
      isAmbiguous: true,
      ambiguityReason: 'Sender mismatch',
    };
    expect(adapter.supports(notification, ambiguousIdentity)).toBe(false);
  });

  it('extracts hierarchy (rack/shelf/slot/port/onuId) and serial from instance suffix and varbinds', () => {
    const notification: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.3.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.637.61.1.36.1.1.1.1.1.2.4.10', // LOS with rack 1, shelf 1, slot 2, port 4, onu 10
      receivedAtMs: 1773316800000,
      varbinds: [
        {
          oid: '1.3.6.1.4.1.637.61.1.36.1.2.1',
          type: 'OctetString',
          value: 'ALCL12345678',
        },
      ],
    };

    const event = executeAdapterSafe(adapter, notification, mockIdentity, mockEvidence);

    expect(event.schema).toBe('ftth.telemetry.v1');
    expect(event.tenantId).toBe('tenant-acme');
    expect(event.deviceKind).toBe('ONU');
    expect(event.deviceId).toBe('ALCL12345678');
    expect(event.metrics.rack).toBe(1);
    expect(event.metrics.shelf).toBe(1);
    expect(event.metrics.slot).toBe(2);
    expect(event.metrics.port).toBe(4);
    expect(event.metrics.onuId).toBe(10);
    expect(event.metrics.serial).toBe('ALCL12345678');
    expect(event.metrics.severity).toBe('critical');
    expect(event.tags?.['serial']).toBe('ALCL12345678');
    expect(event.tags?.['adapter']).toBe('nokia');
  });

  it('decodes hex-encoded serial number octet strings with ALCL prefix without mangling', () => {
    const notification: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.3.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.637.61.1.36.1.1.2.1.1.1.3.5', // Dying gasp
      receivedAtMs: 1773316800000,
      varbinds: [
        {
          oid: '1.3.6.1.4.1.637.61.1.36.1.2.1',
          type: 'OctetString',
          value: '',
          rawHex: '414C434C3837363534333231', // ALCL87654321
        },
      ],
    };

    const event = executeAdapterSafe(adapter, notification, mockIdentity, mockEvidence);

    expect(event.deviceKind).toBe('ONU');
    expect(event.deviceId).toBe('ALCL87654321');
    expect(event.metrics.serial).toBe('ALCL87654321');
    expect(event.metrics.trapCategory).toBe('dying_gasp');
  });

  it('recognizes recovery clear traps (nokiaOntOnline) with isClear: true and cleared category', () => {
    const notification: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.3.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.637.61.1.36.1.1.4.1.1.2.4.10', // Online clear
      receivedAtMs: 1773316800000,
      varbinds: [
        {
          oid: '1.3.6.1.4.1.637.61.1.36.1.2.1',
          type: 'OctetString',
          value: 'ALCL12345678',
        },
      ],
    };

    const event = executeAdapterSafe(adapter, notification, mockIdentity, mockEvidence);

    expect(event.deviceKind).toBe('ONU');
    expect(event.metrics.isClear).toBe(true);
    expect(event.metrics.clearsCategory).toBe('onu_offline');
    expect(event.metrics.severity).toBe('info');
  });

  it('scopes port-level traps (nokiaPonPortDown) to OLT without inventing ONU identity', () => {
    const notification: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.3.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.637.61.1.36.2.1.1.1.1.2.4', // Port down: rack 1, shelf 1, slot 2, port 4
      receivedAtMs: 1773316800000,
      varbinds: [],
    };

    const event = executeAdapterSafe(adapter, notification, mockIdentity, mockEvidence);

    expect(event.deviceKind).toBe('OLT');
    expect(event.deviceId).toBe('nokia-7360-central');
    expect(event.metrics.port).toBe(4);
    expect(event.metrics.slot).toBe(2);
    expect(event.metrics.onuId).toBeUndefined();
    expect(event.metrics.trapCategory).toBe('pon_down');
  });

  it('handles Nokia line card equipment failure (nokiaCardFailure) scoped to OLT', () => {
    const notification: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.3.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.637.61.1.3.1.1.1.3', // Card fault slot 3
      receivedAtMs: 1773316800000,
      varbinds: [],
    };

    const event = executeAdapterSafe(adapter, notification, mockIdentity, mockEvidence);

    expect(event.deviceKind).toBe('OLT');
    expect(event.deviceId).toBe('nokia-7360-central');
    expect(event.metrics.slot).toBe(3);
    expect(event.metrics.trapCategory).toBe('card_failure');
  });

  it('normalizes Nokia Lightspan MF port notifications under PEN 6527', () => {
    const notification: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.3.20',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.6527.3.1.2.2.4.3.1.2', // Lightspan port down: slot 1, port 2
      receivedAtMs: 1773316800000,
      varbinds: [],
    };

    const event = executeAdapterSafe(adapter, notification, mockIdentity, mockEvidence);

    expect(event.deviceKind).toBe('OLT');
    expect(event.metrics.slot).toBe(1);
    expect(event.metrics.port).toBe(2);
    expect(event.metrics.trapCategory).toBe('pon_down');
  });
});
