import { describe, expect, it } from 'vitest';
import { executeAdapterSafe } from '../../src/snmp/adapter/contract';
import { BdcomOltAdapter } from '../../src/snmp/adapter/bdcom';
import type { ResolvedDeviceIdentity } from '../../src/snmp/identity';
import type { DecodedSnmpNotification, RawSnmpEvidenceEnvelope } from '../../src/snmp/types';

describe('BDCOM OLT Vendor Adapter (Roadmap Fase 6)', () => {
  const mockIdentity: ResolvedDeviceIdentity = {
    tenantId: 'tenant-bdcom-isp',
    connectionId: 'conn-bdcom-01',
    oltId: 'bdcom-p3600-south',
    vendor: 'BDCOM',
    pen: 3320,
    isStandardTrap: false,
    isAmbiguous: false,
  };

  const mockEvidence: RawSnmpEvidenceEnvelope = {
    evidenceId: 'ev-bdcom-1',
    receivedAt: '2026-09-10T12:00:00.000Z',
    senderIp: '10.100.7.10',
    senderPort: 162,
    snmpVersion: 'v2c',
    pduType: 'TrapV2',
    trapOid: '1.3.6.1.4.1.3320.101.10.0.2',
    sysUpTime: 765430,
    eventTime: null,
    varbinds: [],
    credentialsRedacted: true,
    fingerprint: 'mock-bdcom-fingerprint',
  };

  const adapter = new BdcomOltAdapter();

  it('supports BDCOM identity, PEN 3320, and BDCOM OIDs, rejecting ambiguous identities', () => {
    const notification: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.7.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.3320.101.10.0.2',
      receivedAtMs: 1773316800000,
      varbinds: [],
    };

    expect(adapter.supports(notification, mockIdentity)).toBe(true);

    const ambiguousIdentity: ResolvedDeviceIdentity = {
      ...mockIdentity,
      isAmbiguous: true,
      ambiguityReason: 'Vendor conflict',
    };
    expect(adapter.supports(notification, ambiguousIdentity)).toBe(false);
  });

  it('normalizes BDCOM GPON ONT Loss of Signal trap with hierarchy and serial', () => {
    const notification: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.7.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.3320.101.10.0.2',
      receivedAtMs: 1773316800000,
      varbinds: [
        { oid: '1.3.6.1.4.1.3320.101.10.1.1.1', type: 'Integer', value: 1 },
        { oid: '1.3.6.1.4.1.3320.101.10.1.1.2', type: 'Integer', value: 4 },
        { oid: '1.3.6.1.4.1.3320.101.10.1.1.3', type: 'Integer', value: 12 },
        { oid: '1.3.6.1.4.1.3320.101.10.1.1.4', type: 'OctetString', value: 'BDCM12345678' },
      ],
    };

    const event = executeAdapterSafe(adapter, notification, mockIdentity, mockEvidence);
    expect(event.schema).toBe('ftth.telemetry.v1');
    expect(event.tenantId).toBe('tenant-bdcom-isp');
    expect(event.deviceKind).toBe('ONU');
    expect(event.deviceId).toBe('BDCM12345678');
    expect(event.metrics.trapCategory).toBe('los');
    expect(event.metrics.severity).toBe('critical');
    expect(event.metrics.slot).toBe(1);
    expect(event.metrics.port).toBe(4);
    expect(event.metrics.onuId).toBe(12);
    expect(event.metrics.serial).toBe('BDCM12345678');
    expect(event.tags?.['adapter']).toBe('bdcom');
  });

  it('normalizes BDCOM GPON ONT Dying Gasp alarm', () => {
    const notification: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.7.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.3320.101.10.0.1',
      receivedAtMs: 1773316800000,
      varbinds: [
        { oid: '1.3.6.1.4.1.3320.101.10.1.1.1', type: 'Integer', value: 1 },
        { oid: '1.3.6.1.4.1.3320.101.10.1.1.2', type: 'Integer', value: 4 },
        { oid: '1.3.6.1.4.1.3320.101.10.1.1.3', type: 'Integer', value: 12 },
        { oid: '1.3.6.1.4.1.3320.101.10.1.1.4', type: 'OctetString', value: 'BDCM12345678' },
      ],
    };

    const event = executeAdapterSafe(adapter, notification, mockIdentity, mockEvidence);
    expect(event.deviceKind).toBe('ONU');
    expect(event.deviceId).toBe('BDCM12345678');
    expect(event.metrics.trapCategory).toBe('dying_gasp');
    expect(event.metrics.severity).toBe('critical');
  });

  it('normalizes BDCOM GPON PON Down trap scoped to OLT', () => {
    const notification: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.7.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.3320.101.10.0.5',
      receivedAtMs: 1773316800000,
      varbinds: [
        { oid: '1.3.6.1.4.1.3320.101.10.1.1.1', type: 'Integer', value: 1 },
        { oid: '1.3.6.1.4.1.3320.101.10.1.1.2', type: 'Integer', value: 4 },
      ],
    };

    const event = executeAdapterSafe(adapter, notification, mockIdentity, mockEvidence);
    expect(event.deviceKind).toBe('OLT');
    expect(event.deviceId).toBe('bdcom-p3600-south');
    expect(event.metrics.trapCategory).toBe('pon_down');
    expect(event.metrics.slot).toBe(1);
    expect(event.metrics.port).toBe(4);
    expect(event.metrics.onuId).toBeUndefined();
  });

  it('normalizes BDCOM recovery traps with isClear and clearsCategory', () => {
    const onlineNotif: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.7.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.3320.101.10.0.3',
      receivedAtMs: 1773316800000,
      varbinds: [
        { oid: '1.3.6.1.4.1.3320.101.10.1.1.1', type: 'Integer', value: 1 },
        { oid: '1.3.6.1.4.1.3320.101.10.1.1.2', type: 'Integer', value: 4 },
        { oid: '1.3.6.1.4.1.3320.101.10.1.1.3', type: 'Integer', value: 12 },
        { oid: '1.3.6.1.4.1.3320.101.10.1.1.4', type: 'OctetString', value: 'BDCM12345678' },
      ],
    };

    const onlineEvent = executeAdapterSafe(adapter, onlineNotif, mockIdentity, mockEvidence);
    expect(onlineEvent.metrics.trapCategory).toBe('onu_online');
    expect(onlineEvent.metrics.severity).toBe('info');
    expect(onlineEvent.metrics.isClear).toBe(true);
    expect(onlineEvent.metrics.clearsCategory).toBe('onu_offline');

    const ponUpNotif: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.7.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.3320.101.10.0.6',
      receivedAtMs: 1773316800000,
      varbinds: [
        { oid: '1.3.6.1.4.1.3320.101.10.1.1.1', type: 'Integer', value: 1 },
        { oid: '1.3.6.1.4.1.3320.101.10.1.1.2', type: 'Integer', value: 4 },
      ],
    };

    const ponUpEvent = executeAdapterSafe(adapter, ponUpNotif, mockIdentity, mockEvidence);
    expect(ponUpEvent.deviceKind).toBe('OLT');
    expect(ponUpEvent.metrics.trapCategory).toBe('pon_up');
    expect(ponUpEvent.metrics.isClear).toBe(true);
    expect(ponUpEvent.metrics.clearsCategory).toBe('pon_down');
  });
});
