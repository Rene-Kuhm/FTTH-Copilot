import { describe, expect, it } from 'vitest';
import { executeAdapterSafe } from '../../src/snmp/adapter/contract';
import { AdtranOltAdapter } from '../../src/snmp/adapter/adtran';
import type { ResolvedDeviceIdentity } from '../../src/snmp/identity';
import type { DecodedSnmpNotification, RawSnmpEvidenceEnvelope } from '../../src/snmp/types';

describe('ADTRAN Total Access 5000 OLT Adapter (Roadmap Fase 5)', () => {
  const mockIdentity: ResolvedDeviceIdentity = {
    tenantId: 'tenant-adtran-fiber',
    connectionId: 'conn-adtran-01',
    oltId: 'adtran-ta5000-south',
    vendor: 'Adtran',
    pen: 664,
    isStandardTrap: false,
    isAmbiguous: false,
  };

  const mockEvidence: RawSnmpEvidenceEnvelope = {
    evidenceId: 'ev-adtran-1',
    receivedAt: '2026-09-10T12:00:00.000Z',
    senderIp: '10.100.5.10',
    senderPort: 162,
    snmpVersion: 'v2c',
    pduType: 'TrapV2',
    trapOid: '1.3.6.1.4.1.664.6.10000.76.1.1.5.1.0.1.1.2.4',
    sysUpTime: 612000,
    eventTime: null,
    varbinds: [],
    credentialsRedacted: true,
    fingerprint: 'mock-adtran-fingerprint',
  };

  const adapter = new AdtranOltAdapter();

  it('supports Adtran identity, PEN 664, and Adtran OIDs, rejecting ambiguous identities', () => {
    const notification: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.5.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.664.6.10000.76.1.1.5.1.0.1',
      receivedAtMs: 1773316800000,
      varbinds: [],
    };

    expect(adapter.supports(notification, mockIdentity)).toBe(true);

    const ambiguousIdentity: ResolvedDeviceIdentity = {
      ...mockIdentity,
      isAmbiguous: true,
      ambiguityReason: 'Conflicting sender registration',
    };
    expect(adapter.supports(notification, ambiguousIdentity)).toBe(false);
  });

  it('explicitly rejects SDX-6000 / Mosaic architecture to prevent invalid MIB assumptions (Gate 5)', () => {
    const notification: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.5.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.664.6.10000.76.1.1.5.1.0.1',
      receivedAtMs: 1773316800000,
      varbinds: [],
    };

    const sdxIdentity: ResolvedDeviceIdentity = {
      ...mockIdentity,
      model: 'SDX 6320-16',
    };
    expect(adapter.supports(notification, sdxIdentity)).toBe(false);

    const mosaicIdentity: ResolvedDeviceIdentity = {
      ...mockIdentity,
      hardwareModel: 'Adtran Mosaic Cloud Platform OLT',
    };
    expect(adapter.supports(notification, mosaicIdentity)).toBe(false);
  });

  it('extracts hierarchy (slot/port/onuId) and serial from instance suffix and varbinds', () => {
    const notification: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.5.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.664.6.10000.76.1.1.5.1.0.1.1.2.4', // LOS on slot 1, port 2, onu 4
      receivedAtMs: 1773316800000,
      varbinds: [
        {
          oid: '1.3.6.1.2.1.2.2.1.2.10204',
          type: 'OctetString',
          value: 'ont 1/2.4',
        },
        {
          oid: '1.3.6.1.4.1.664.6.10000.76.1.1.1.1.3.10204',
          type: 'OctetString',
          value: 'ADTN12345678',
        },
      ],
    };

    const event = executeAdapterSafe(adapter, notification, mockIdentity, mockEvidence);

    expect(event.schema).toBe('ftth.telemetry.v1');
    expect(event.tenantId).toBe('tenant-adtran-fiber');
    expect(event.deviceKind).toBe('ONU');
    expect(event.deviceId).toBe('ADTN12345678');
    expect(event.metrics.trapCategory).toBe('los');
    expect(event.metrics.severity).toBe('critical');
    expect(event.metrics.slot).toBe(1);
    expect(event.metrics.port).toBe(2);
    expect(event.metrics.onuId).toBe(4);
    expect(event.metrics.serial).toBe('ADTN12345678');
    expect(event.tags?.['serial']).toBe('ADTN12345678');
    expect(event.tags?.['adapter']).toBe('adtran');
  });

  it('decodes hex-encoded serial numbers with ADTN prefix', () => {
    const notification: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.5.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.664.6.10000.76.1.1.5.1.0.38.1.1.10',
      receivedAtMs: 1773316800000,
      varbinds: [
        {
          oid: '1.3.6.1.2.1.2.2.1.2.10110',
          type: 'OctetString',
          value: 'ont 1/1.10',
        },
        {
          oid: '1.3.6.1.4.1.664.6.10000.76.1.1.1.1.3.10110',
          type: 'OctetString',
          value: 'ADTN98765432',
          rawHex: '4144544E3938373635343332',
        },
      ],
    };

    const event = executeAdapterSafe(adapter, notification, mockIdentity, mockEvidence);
    expect(event.deviceKind).toBe('ONU');
    expect(event.deviceId).toBe('ADTN98765432');
    expect(event.metrics.trapCategory).toBe('dying_gasp');
    expect(event.metrics.severity).toBe('critical');
    expect(event.metrics.onuId).toBe(10);
  });

  it('correctly scopes PON port-level events to OLT deviceKind without creating false ONUs', () => {
    const portDownNotification: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.5.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.664.6.10000.76.1.1.5.1.0.5.1.2',
      receivedAtMs: 1773316800000,
      varbinds: [
        {
          oid: '1.3.6.1.2.1.2.2.1.2.10200',
          type: 'OctetString',
          value: 'gpon 1/2',
        },
      ],
    };

    const event = executeAdapterSafe(adapter, portDownNotification, mockIdentity, mockEvidence);
    expect(event.deviceKind).toBe('OLT');
    expect(event.deviceId).toBe('adtran-ta5000-south');
    expect(event.metrics.trapCategory).toBe('pon_down');
    expect(event.metrics.slot).toBe(1);
    expect(event.metrics.port).toBe(2);
    expect(event.metrics.onuId).toBeUndefined();
  });

  it('correctly normalizes recovery events with isClear and clearsCategory', () => {
    const onlineNotification: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.5.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.664.6.10000.76.1.1.5.1.0.26.1.2.4', // adGenGponOntOnline
      receivedAtMs: 1773316800000,
      varbinds: [
        {
          oid: '1.3.6.1.2.1.2.2.1.2.10204',
          type: 'OctetString',
          value: 'ont 1/2.4',
        },
        {
          oid: '1.3.6.1.4.1.664.6.10000.76.1.1.1.1.3.10204',
          type: 'OctetString',
          value: 'ADTN12345678',
        },
      ],
    };

    const event = executeAdapterSafe(adapter, onlineNotification, mockIdentity, mockEvidence);
    expect(event.deviceKind).toBe('ONU');
    expect(event.deviceId).toBe('ADTN12345678');
    expect(event.metrics.trapCategory).toBe('onu_online');
    expect(event.metrics.severity).toBe('info');
    expect(event.metrics.isClear).toBe(true);
    expect(event.metrics.clearsCategory).toBe('onu_offline');
  });
});
