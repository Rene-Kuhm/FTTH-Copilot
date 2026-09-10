import { describe, expect, it } from 'vitest';
import { executeAdapterSafe } from '../../src/snmp/adapter/contract';
import { CalixOltAdapter } from '../../src/snmp/adapter/calix';
import type { ResolvedDeviceIdentity } from '../../src/snmp/identity';
import type { DecodedSnmpNotification, RawSnmpEvidenceEnvelope } from '../../src/snmp/types';

describe('Calix Networks OLT Adapter (Roadmap Fase 5)', () => {
  const mockIdentity: ResolvedDeviceIdentity = {
    tenantId: 'tenant-calix-isp',
    connectionId: 'conn-calix-01',
    oltId: 'calix-e7-north',
    vendor: 'Calix',
    pen: 6321,
    isStandardTrap: false,
    isAmbiguous: false,
  };

  const mockEvidence: RawSnmpEvidenceEnvelope = {
    evidenceId: 'ev-calix-1',
    receivedAt: '2026-09-10T12:00:00.000Z',
    senderIp: '10.100.4.10',
    senderPort: 162,
    snmpVersion: 'v2c',
    pduType: 'TrapV2',
    trapOid: '1.3.6.1.4.1.6321.1.2.2.4.2.1',
    sysUpTime: 1234500,
    eventTime: null,
    varbinds: [],
    credentialsRedacted: true,
    fingerprint: 'mock-calix-fingerprint',
  };

  const adapter = new CalixOltAdapter();

  it('supports Calix identity, PENs (6321, 1264), and Calix OIDs, rejecting ambiguous identities', () => {
    const notification: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.4.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.6321.1.2.2.4.2.1',
      receivedAtMs: 1773316800000,
      varbinds: [],
    };

    expect(adapter.supports(notification, mockIdentity)).toBe(true);

    const legacyPenIdentity: ResolvedDeviceIdentity = {
      ...mockIdentity,
      pen: 1264,
    };
    expect(adapter.supports(notification, legacyPenIdentity)).toBe(true);

    const ambiguousIdentity: ResolvedDeviceIdentity = {
      ...mockIdentity,
      isAmbiguous: true,
      ambiguityReason: 'Multiple matching vendors',
    };
    expect(adapter.supports(notification, ambiguousIdentity)).toBe(false);
  });

  it('explicitly rejects E9 / AXOS architecture to prevent invalid MIB assumptions (Gate 5)', () => {
    const notification: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.4.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.6321.1.2.2.4.2.1',
      receivedAtMs: 1773316800000,
      varbinds: [],
    };

    const e9Identity: ResolvedDeviceIdentity = {
      ...mockIdentity,
      model: 'AXOS E9-2',
    };
    expect(adapter.supports(notification, e9Identity)).toBe(false);

    const axosIdentity: ResolvedDeviceIdentity = {
      ...mockIdentity,
      hardwareModel: 'Calix AXOS Appliance',
    };
    expect(adapter.supports(notification, axosIdentity)).toBe(false);
  });

  it('extracts optical hierarchy (shelf/slot/port/onuId), CLI object, and serial from varbinds', () => {
    const notification: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.4.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.6321.1.2.2.4.2.1',
      receivedAtMs: 1773316800000,
      varbinds: [
        {
          oid: '1.3.6.1.4.1.6321.1.2.2.4.1.1.6',
          type: 'OctetString',
          value: 'ont 1/1/2/4',
        },
        {
          oid: '1.3.6.1.4.1.6321.1.2.2.4.1.1.7',
          type: 'OctetString',
          value: 'Loss of Signal',
        },
        {
          oid: '1.3.6.1.4.1.6321.1.2.2.4.1.1.10',
          type: 'OctetString',
          value: 'CXNK00123456',
        },
      ],
    };

    const event = executeAdapterSafe(adapter, notification, mockIdentity, mockEvidence);

    expect(event.schema).toBe('ftth.telemetry.v1');
    expect(event.tenantId).toBe('tenant-calix-isp');
    expect(event.deviceKind).toBe('ONU');
    expect(event.deviceId).toBe('CXNK00123456');
    expect(event.metrics.trapCategory).toBe('los');
    expect(event.metrics.severity).toBe('critical');
    expect(event.metrics.shelf).toBe(1);
    expect(event.metrics.slot).toBe(1);
    expect(event.metrics.port).toBe(2);
    expect(event.metrics.onuId).toBe(4);
    expect(event.metrics.serial).toBe('CXNK00123456');
    expect(event.metrics.cliObject).toBe('ont 1/1/2/4');
    expect(event.metrics.eventText).toBe('Loss of Signal');
    expect(event.tags?.['serial']).toBe('CXNK00123456');
    expect(event.tags?.['adapter']).toBe('calix');
  });

  it('decodes hex-encoded serial numbers with CXNK prefix', () => {
    const notification: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.4.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.6321.1.2.2.4.2.1',
      receivedAtMs: 1773316800000,
      varbinds: [
        {
          oid: '1.3.6.1.4.1.6321.1.2.2.4.1.1.6',
          type: 'OctetString',
          value: 'ont 1/1/1/8',
        },
        {
          oid: '1.3.6.1.4.1.6321.1.2.2.4.1.1.7',
          type: 'OctetString',
          value: 'Dying Gasp',
        },
        {
          oid: '1.3.6.1.4.1.6321.1.2.2.4.1.1.10',
          type: 'OctetString',
          value: 'CXNKABCD1234',
          rawHex: '43584E4B4142434431323334',
        },
      ],
    };

    const event = executeAdapterSafe(adapter, notification, mockIdentity, mockEvidence);
    expect(event.deviceKind).toBe('ONU');
    expect(event.deviceId).toBe('CXNKABCD1234');
    expect(event.metrics.trapCategory).toBe('dying_gasp');
    expect(event.metrics.severity).toBe('critical');
    expect(event.metrics.onuId).toBe(8);
  });

  it('correctly scopes PON port and card-level events to OLT deviceKind without creating false ONUs', () => {
    const portDownNotification: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.4.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.6321.1.2.2.4.2.1',
      receivedAtMs: 1773316800000,
      varbinds: [
        {
          oid: '1.3.6.1.4.1.6321.1.2.2.4.1.1.6',
          type: 'OctetString',
          value: 'port 1/1/2',
        },
        {
          oid: '1.3.6.1.4.1.6321.1.2.2.4.1.1.7',
          type: 'OctetString',
          value: 'PON Link Down',
        },
      ],
    };

    const event = executeAdapterSafe(adapter, portDownNotification, mockIdentity, mockEvidence);
    expect(event.deviceKind).toBe('OLT');
    expect(event.deviceId).toBe('calix-e7-north');
    expect(event.metrics.trapCategory).toBe('pon_down');
    expect(event.metrics.shelf).toBe(1);
    expect(event.metrics.slot).toBe(1);
    expect(event.metrics.port).toBe(2);
    expect(event.metrics.onuId).toBeUndefined();
  });

  it('correctly normalizes recovery events with isClear and clearsCategory', () => {
    const clearNotification: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.4.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.6321.1.2.2.4.2.10', // e7TrapAlarmClear
      receivedAtMs: 1773316800000,
      varbinds: [
        {
          oid: '1.3.6.1.4.1.6321.1.2.2.4.1.1.6',
          type: 'OctetString',
          value: 'ont 1/1/2/4',
        },
        {
          oid: '1.3.6.1.4.1.6321.1.2.2.4.1.1.7',
          type: 'OctetString',
          value: 'Loss of Signal Cleared',
        },
        {
          oid: '1.3.6.1.4.1.6321.1.2.2.4.1.1.10',
          type: 'OctetString',
          value: 'CXNK00123456',
        },
      ],
    };

    const event = executeAdapterSafe(adapter, clearNotification, mockIdentity, mockEvidence);
    expect(event.deviceKind).toBe('ONU');
    expect(event.deviceId).toBe('CXNK00123456');
    expect(event.metrics.trapCategory).toBe('los_clear');
    expect(event.metrics.severity).toBe('info');
    expect(event.metrics.isClear).toBe(true);
    expect(event.metrics.clearsCategory).toBe('los');
  });

  it('never mistakes event text with spaces or non-serial keywords for ONT serial', () => {
    const notification: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.4.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.6321.1.2.2.4.2.1',
      receivedAtMs: 1773316800000,
      varbinds: [
        {
          oid: '1.3.6.1.4.1.6321.1.2.2.4.1.1.6',
          type: 'OctetString',
          value: 'ont 1/1/2/4',
        },
        {
          oid: '1.3.6.1.4.1.6321.1.2.2.4.1.1.7',
          type: 'OctetString',
          value: 'Loss of Signal',
          rawHex: '4c6f7373206f66205369676e616c',
        },
      ],
    };

    const event = executeAdapterSafe(adapter, notification, mockIdentity, mockEvidence);
    expect(event.deviceKind).toBe('ONU');
    // Without valid serial varbind, falls back to OLT-scoped hierarchical deviceId
    expect(event.deviceId).toBe('calix-e7-north:onu:1/1/2/4');
    expect(event.metrics.serial).toBeUndefined();
    expect(event.metrics.eventText).toBe('Loss of Signal');
  });
});
