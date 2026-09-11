import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { executeAdapterSafe } from '../../src/snmp/adapter/contract';
import { ZteOltAdapter } from '../../src/snmp/adapter/zte';
import { setSimulatorProvisionalTraps } from '../../src/snmp/catalog';
import type { ResolvedDeviceIdentity } from '../../src/snmp/identity';
import type { DecodedSnmpNotification, RawSnmpEvidenceEnvelope } from '../../src/snmp/types';

describe('ZTE OLT Adapter (Roadmap Fase 3)', () => {
  beforeAll(() => {
    setSimulatorProvisionalTraps(true);
  });

  afterAll(() => {
    setSimulatorProvisionalTraps(false);
  });
  const mockIdentity: ResolvedDeviceIdentity = {
    tenantId: 'tenant-acme',
    connectionId: 'conn-zte-01',
    oltId: 'zte-c300-metro',
    vendor: 'ZTE',
    pen: 3902,
    isStandardTrap: false,
    isAmbiguous: false,
  };

  const mockEvidence: RawSnmpEvidenceEnvelope = {
    evidenceId: 'ev-zte-1',
    receivedAt: '2026-09-10T12:00:00.000Z',
    senderIp: '10.100.2.10',
    senderPort: 162,
    snmpVersion: 'v2c',
    pduType: 'TrapV2',
    trapOid: '1.3.6.1.4.1.3902.1082.500.10.2.2.1.1.1.3.2.5',
    sysUpTime: 120500,
    eventTime: null,
    varbinds: [],
    credentialsRedacted: true,
    fingerprint: 'mock-zte-fingerprint',
  };

  const adapter = new ZteOltAdapter();

  it('supports ZTE identity, PEN 3902, and ZTE OIDs, rejecting ambiguous identities', () => {
    const notification: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.2.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.3902.1082.500.10.2.2.1',
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

  it('extracts hierarchy (rack/shelf/slot/port/onuId) and serial from instance suffix and varbinds (Requirement 2)', () => {
    const notification: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.2.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.3902.1082.500.10.2.2.1.1.1.3.2.5', // Rack 1, Shelf 1, Slot 3, Port 2, ONU 5
      receivedAtMs: 1773316800000,
      varbinds: [
        {
          oid: '1.3.6.1.4.1.3902.1082.500.10.2.2.1.1.1',
          type: 'OctetString',
          value: 'ZTEGC8765432',
        },
      ],
    };

    const event = executeAdapterSafe(adapter, notification, mockIdentity, mockEvidence);

    expect(event.schema).toBe('ftth.telemetry.v1');
    expect(event.tenantId).toBe('tenant-acme');
    expect(event.deviceKind).toBe('ONU');
    expect(event.deviceId).toBe('ZTEGC8765432');
    expect(event.metrics.rack).toBe(1);
    expect(event.metrics.shelf).toBe(1);
    expect(event.metrics.slot).toBe(3);
    expect(event.metrics.port).toBe(2);
    expect(event.metrics.onuId).toBe(5);
    expect(event.metrics.serial).toBe('ZTEGC8765432');
    expect(event.metrics.severity).toBe('critical');
    expect(event.tags?.['serial']).toBe('ZTEGC8765432');
    expect(event.tags?.['adapter']).toBe('zte');
  });

  it('suppresses provisional loss of signal to unknown_trap (info) with catalogStatus provisional by default', () => {
    setSimulatorProvisionalTraps(false);
    const notification: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.2.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.3902.1082.500.10.2.2.1.1.1.3.2.5',
      receivedAtMs: 1773316800000,
      varbinds: [
        {
          oid: '1.3.6.1.4.1.3902.1082.500.10.2.2.1.1.1',
          type: 'OctetString',
          value: 'ZTEGC8765432',
        },
      ],
    };

    const event = executeAdapterSafe(adapter, notification, mockIdentity, mockEvidence);
    expect(event.metrics.severity).toBe('info');
    expect(event.metrics.trapCategory).toBe('unknown_trap');
    expect(event.metrics.trapName).toBe('provisionalTrap');
    expect(event.metrics.candidateTrapName).toBe('zxGponOntLossOfSignal');
    expect(event.metrics.candidateDescription).toBe(
      'Loss of optical signal on ZTE GPON ONT',
    );
    expect(event.metrics.description).toBe(
      'Provisional unverified SNMP trap OID awaiting physical lab confirmation',
    );
    expect(event.metrics.catalogStatus).toBe('provisional');
    expect(event.tags?.['catalogStatus']).toBe('provisional');
    setSimulatorProvisionalTraps(true);
  });

  it('does not fabricate artificial ONU device ID when provisional trap lacks verifiable serial or hierarchy', () => {
    setSimulatorProvisionalTraps(false);
    const notification: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.2.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.3902.1082.500.10.2.2.2',
      receivedAtMs: 1773316800000,
      varbinds: [],
    };

    const event = executeAdapterSafe(adapter, notification, mockIdentity, mockEvidence);
    expect(event.deviceKind).toBe('OLT');
    expect(event.deviceId).toBe(mockIdentity.oltId);
    expect(event.metrics.trapCategory).toBe('unknown_trap');
    expect(event.metrics.candidateTrapName).toBe('zxGponOntDyingGasp');
    expect(event.metrics.candidateDeviceKind).toBe('ONU');
    setSimulatorProvisionalTraps(true);
  });

  it('decodes hex-encoded serial number octet strings without mangling (Requirement 3)', () => {
    const notification: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.2.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.3902.1082.500.10.2.2.1.1.1.3.2.5',
      receivedAtMs: 1773316800000,
      varbinds: [
        {
          oid: '1.3.6.1.4.1.3902.1082.500.10.2.2.1.1.1',
          type: 'OctetString',
          value: null,
          rawHex: '5a544547c8765432', // ZTEGC8765432 in hex
        },
      ],
    };

    const event = executeAdapterSafe(adapter, notification, mockIdentity, mockEvidence);

    expect(event.deviceKind).toBe('ONU');
    expect(event.deviceId).toBe('ZTEGC8765432');
    expect(event.metrics.serial).toBe('ZTEGC8765432');
  });

  it('normalizes alarm and clear pairs for ONT events (Requirement 4)', () => {
    // 1. Offline alarm
    const offlineNotif: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.2.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.3902.1082.500.10.2.2.10.1.1.2.1.10',
      receivedAtMs: 1773316800000,
      varbinds: [
        { oid: '1.3.6.1.4.1.3902.1082.500.10.2.2.1.1.1', type: 'OctetString', value: 'ZTEG11223344' },
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
      senderIp: '10.100.2.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.3902.1082.500.10.2.2.11.1.1.2.1.10',
      receivedAtMs: 1773316800000,
      varbinds: [
        { oid: '1.3.6.1.4.1.3902.1082.500.10.2.2.1.1.1', type: 'OctetString', value: 'ZTEG11223344' },
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
      senderIp: '10.100.2.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.3902.1082.500.10.2.2.12.1.1.2.1.10',
      receivedAtMs: 1773316800000,
      varbinds: [
        { oid: '1.3.6.1.4.1.3902.1082.500.10.2.2.1.1.1', type: 'OctetString', value: 'ZTEG11223344' },
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
      senderIp: '10.100.2.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.3902.1082.500.10.2.2.20.1.1.2.1', // Rack 1, Shelf 1, Slot 2, Port 1
      receivedAtMs: 1773316800000,
      varbinds: [],
    };

    const portDownEvent = executeAdapterSafe(adapter, portDownNotif, mockIdentity, mockEvidence);
    expect(portDownEvent.deviceKind).toBe('OLT');
    expect(portDownEvent.deviceId).toBe('zte-c300-metro');
    expect(portDownEvent.metrics.rack).toBe(1);
    expect(portDownEvent.metrics.shelf).toBe(1);
    expect(portDownEvent.metrics.slot).toBe(2);
    expect(portDownEvent.metrics.port).toBe(1);
    expect(portDownEvent.metrics.severity).toBe('critical');

    // Port Up (Clear)
    const portUpNotif: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.2.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.3902.1082.500.10.2.2.21.1.1.2.1',
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
      senderIp: '10.100.2.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.3902.1082.500.10.2.2.1.1.1.3.2.5',
      receivedAtMs: 1773316800000,
      varbinds: [], // no serial varbind
    };

    const event = executeAdapterSafe(adapter, notification, mockIdentity, mockEvidence);
    expect(event.deviceKind).toBe('ONU');
    expect(event.deviceId).toBe('zte-c300-metro:onu:3/2/5');
  });
});
