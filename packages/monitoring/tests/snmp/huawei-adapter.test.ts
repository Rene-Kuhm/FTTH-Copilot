import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { executeAdapterSafe } from '../../src/snmp/adapter/contract';
import { HuaweiOltAdapter } from '../../src/snmp/adapter/huawei';
import { setSimulatorProvisionalTraps } from '../../src/snmp/catalog';
import type { ResolvedDeviceIdentity } from '../../src/snmp/identity';
import type { DecodedSnmpNotification, RawSnmpEvidenceEnvelope } from '../../src/snmp/types';

describe('Huawei OLT Adapter (Roadmap Fase 3)', () => {
  beforeAll(() => {
    setSimulatorProvisionalTraps(true);
  });

  afterAll(() => {
    setSimulatorProvisionalTraps(false);
  });
  const mockIdentity: ResolvedDeviceIdentity = {
    tenantId: 'tenant-acme',
    connectionId: 'conn-huawei-01',
    oltId: 'huawei-ma5600-central',
    vendor: 'Huawei',
    pen: 2011,
    isStandardTrap: false,
    isAmbiguous: false,
  };

  const mockEvidence: RawSnmpEvidenceEnvelope = {
    evidenceId: 'ev-hw-1',
    receivedAt: '2026-09-10T12:00:00.000Z',
    senderIp: '10.100.1.10',
    senderPort: 162,
    snmpVersion: 'v2c',
    pduType: 'TrapV2',
    trapOid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.2.0.2.1.14',
    sysUpTime: 345600,
    eventTime: null,
    varbinds: [],
    credentialsRedacted: true,
    fingerprint: 'mock-hw-fingerprint',
  };

  const adapter = new HuaweiOltAdapter();

  it('supports Huawei identity, PEN 2011, and Huawei OIDs, rejecting ambiguous identities', () => {
    const notification: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.1.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.2',
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

  it('extracts hierarchy (frame/slot/port/onuId) and serial from instance suffix and varbinds', () => {
    const notification: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.1.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.2.0.2.1.14', // Dying gasp with frame 0, slot 2, port 1, onu 14
      receivedAtMs: 1773316800000,
      varbinds: [
        {
          oid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.1.1',
          type: 'OctetString',
          value: 'HWTC12345678',
        },
      ],
    };

    const event = executeAdapterSafe(adapter, notification, mockIdentity, mockEvidence);

    expect(event.schema).toBe('ftth.telemetry.v1');
    expect(event.tenantId).toBe('tenant-acme');
    expect(event.deviceKind).toBe('ONU');
    expect(event.deviceId).toBe('HWTC12345678');
    expect(event.metrics.frame).toBe(0);
    expect(event.metrics.slot).toBe(2);
    expect(event.metrics.port).toBe(1);
    expect(event.metrics.onuId).toBe(14);
    expect(event.metrics.serial).toBe('HWTC12345678');
    expect(event.metrics.severity).toBe('critical');
    expect(event.tags?.['serial']).toBe('HWTC12345678');
    expect(event.tags?.['adapter']).toBe('huawei');
  });

  it('suppresses provisional dying gasp to unknown_trap (info) with catalogStatus provisional by default', () => {
    setSimulatorProvisionalTraps(false);
    const notification: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.1.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.2.0.2.1.14',
      receivedAtMs: 1773316800000,
      varbinds: [
        {
          oid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.1.1',
          type: 'OctetString',
          value: 'HWTC12345678',
        },
      ],
    };

    const event = executeAdapterSafe(adapter, notification, mockIdentity, mockEvidence);
    expect(event.metrics.severity).toBe('info');
    expect(event.metrics.trapCategory).toBe('unknown_trap');
    expect(event.metrics.catalogStatus).toBe('provisional');
    expect(event.tags?.['catalogStatus']).toBe('provisional');
    setSimulatorProvisionalTraps(true);
  });

  it('decodes hex-encoded serial number octet strings without mangling (Requirement 3)', () => {
    const notification: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.1.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.2.0.2.1.14',
      receivedAtMs: 1773316800000,
      varbinds: [
        {
          oid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.1.1',
          type: 'OctetString',
          value: null,
          rawHex: '4857544331323334', // HWTC1234 in hex
        },
      ],
    };

    const event = executeAdapterSafe(adapter, notification, mockIdentity, mockEvidence);

    expect(event.deviceKind).toBe('ONU');
    expect(event.deviceId).toBe('HWTC1234');
    expect(event.metrics.serial).toBe('HWTC1234');
  });

  it('normalizes alarm and clear pairs for ONT events (Requirement 4)', () => {
    // 1. Offline alarm
    const offlineNotif: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.1.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.10.0.1.3.22',
      receivedAtMs: 1773316800000,
      varbinds: [
        { oid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.1.1', type: 'OctetString', value: 'HWTC98765432' },
      ],
    };

    const offlineEvent = executeAdapterSafe(adapter, offlineNotif, mockIdentity, mockEvidence);
    expect(offlineEvent.metrics.trapCategory).toBe('onu_offline');
    expect(offlineEvent.metrics.severity).toBe('warning');
    expect(offlineEvent.metrics.isClear).toBeUndefined();

    // 2. Online clear
    const onlineNotif: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.1.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.11.0.1.3.22',
      receivedAtMs: 1773316800000,
      varbinds: [
        { oid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.1.1', type: 'OctetString', value: 'HWTC98765432' },
      ],
    };

    const onlineEvent = executeAdapterSafe(adapter, onlineNotif, mockIdentity, mockEvidence);
    expect(onlineEvent.metrics.trapCategory).toBe('onu_online');
    expect(onlineEvent.metrics.severity).toBe('info');
    expect(onlineEvent.metrics.isClear).toBe(true);
    expect(onlineEvent.metrics.clearsCategory).toBe('onu_offline');

    // 3. LOS Clear
    const losClearNotif: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.1.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.12.0.1.3.22',
      receivedAtMs: 1773316800000,
      varbinds: [
        { oid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.1.1', type: 'OctetString', value: 'HWTC98765432' },
      ],
    };

    const losClearEvent = executeAdapterSafe(adapter, losClearNotif, mockIdentity, mockEvidence);
    expect(losClearEvent.metrics.isClear).toBe(true);
    expect(losClearEvent.metrics.clearsCategory).toBe('los');
  });

  it('normalizes PON port down/up traps with deviceKind: OLT (Requirement 5)', () => {
    // Port Down
    const portDownNotif: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.1.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.20.0.1.4', // Frame 0, Slot 1, Port 4
      receivedAtMs: 1773316800000,
      varbinds: [],
    };

    const portDownEvent = executeAdapterSafe(adapter, portDownNotif, mockIdentity, mockEvidence);
    expect(portDownEvent.deviceKind).toBe('OLT');
    expect(portDownEvent.deviceId).toBe('huawei-ma5600-central');
    expect(portDownEvent.metrics.frame).toBe(0);
    expect(portDownEvent.metrics.slot).toBe(1);
    expect(portDownEvent.metrics.port).toBe(4);
    expect(portDownEvent.metrics.severity).toBe('critical');

    // Port Up (Clear)
    const portUpNotif: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.1.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.21.0.1.4',
      receivedAtMs: 1773316800000,
      varbinds: [],
    };

    const portUpEvent = executeAdapterSafe(adapter, portUpNotif, mockIdentity, mockEvidence);
    expect(portUpEvent.deviceKind).toBe('OLT');
    expect(portUpEvent.metrics.isClear).toBe(true);
    expect(portUpEvent.metrics.clearsCategory).toBe('pon_down');
  });

  it('falls back to synthesized deviceId if serial is absent in ONT trap', () => {
    const notification: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.1.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.2.0.2.1.14',
      receivedAtMs: 1773316800000,
      varbinds: [], // no serial varbind
    };

    const event = executeAdapterSafe(adapter, notification, mockIdentity, mockEvidence);
    expect(event.deviceKind).toBe('ONU');
    expect(event.deviceId).toBe('huawei-ma5600-central:onu:0/2/1/14');
  });
});
