import { describe, expect, it } from 'vitest';
import { executeAdapterSafe } from '../../src/snmp/adapter/contract';
import { VsolOltAdapter } from '../../src/snmp/adapter/vsol';
import type { ResolvedDeviceIdentity } from '../../src/snmp/identity';
import type { DecodedSnmpNotification, RawSnmpEvidenceEnvelope } from '../../src/snmp/types';

describe('VSOL OLT Vendor Adapter (Roadmap Fase 6)', () => {
  const mockIdentity: ResolvedDeviceIdentity = {
    tenantId: 'tenant-vsol-isp',
    connectionId: 'conn-vsol-01',
    oltId: 'vsol-v1600-central',
    vendor: 'VSOL',
    pen: 37950,
    isStandardTrap: false,
    isAmbiguous: false,
  };

  const mockEvidence: RawSnmpEvidenceEnvelope = {
    evidenceId: 'ev-vsol-1',
    receivedAt: '2026-09-10T12:00:00.000Z',
    senderIp: '10.100.6.10',
    senderPort: 162,
    snmpVersion: 'v2c',
    pduType: 'TrapV2',
    trapOid: '1.3.6.1.4.1.37950.5.1.1.2',
    sysUpTime: 543210,
    eventTime: null,
    varbinds: [],
    credentialsRedacted: true,
    fingerprint: 'mock-vsol-fingerprint',
  };

  const adapter = new VsolOltAdapter();

  it('supports VSOL identity, PEN 37950, and VSOL OIDs, rejecting ambiguous identities', () => {
    const notification: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.6.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.37950.5.1.1.2',
      receivedAtMs: 1773316800000,
      varbinds: [],
    };

    expect(adapter.supports(notification, mockIdentity)).toBe(true);

    const ambiguousIdentity: ResolvedDeviceIdentity = {
      ...mockIdentity,
      isAmbiguous: true,
      ambiguityReason: 'Conflicting vendors',
    };
    expect(adapter.supports(notification, ambiguousIdentity)).toBe(false);
  });

  it('normalizes VSOL GPON ONT Loss of Signal trap with hierarchy and serial', () => {
    const notification: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.6.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.37950.5.1.1.2',
      receivedAtMs: 1773316800000,
      varbinds: [
        { oid: '1.3.6.1.4.1.37950.5.1.10.1', type: 'Integer', value: 1 },
        { oid: '1.3.6.1.4.1.37950.5.1.10.2', type: 'Integer', value: 2 },
        { oid: '1.3.6.1.4.1.37950.5.1.10.3', type: 'Integer', value: 5 },
        { oid: '1.3.6.1.4.1.37950.5.1.10.4', type: 'OctetString', value: 'VSOL12345678' },
      ],
    };

    const event = executeAdapterSafe(adapter, notification, mockIdentity, mockEvidence);
    expect(event.schema).toBe('ftth.telemetry.v1');
    expect(event.tenantId).toBe('tenant-vsol-isp');
    expect(event.deviceKind).toBe('ONU');
    expect(event.deviceId).toBe('VSOL12345678');
    expect(event.metrics.trapCategory).toBe('los');
    expect(event.metrics.severity).toBe('critical');
    expect(event.metrics.slot).toBe(1);
    expect(event.metrics.port).toBe(2);
    expect(event.metrics.onuId).toBe(5);
    expect(event.metrics.serial).toBe('VSOL12345678');
    expect(event.tags?.['adapter']).toBe('vsol');
  });

  it('normalizes VSOL GPON ONT Dying Gasp alarm', () => {
    const notification: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.6.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.37950.5.1.1.1',
      receivedAtMs: 1773316800000,
      varbinds: [
        { oid: '1.3.6.1.4.1.37950.5.1.10.1', type: 'Integer', value: 1 },
        { oid: '1.3.6.1.4.1.37950.5.1.10.2', type: 'Integer', value: 2 },
        { oid: '1.3.6.1.4.1.37950.5.1.10.3', type: 'Integer', value: 5 },
        { oid: '1.3.6.1.4.1.37950.5.1.10.4', type: 'OctetString', value: 'VSOL12345678' },
      ],
    };

    const event = executeAdapterSafe(adapter, notification, mockIdentity, mockEvidence);
    expect(event.deviceKind).toBe('ONU');
    expect(event.deviceId).toBe('VSOL12345678');
    expect(event.metrics.trapCategory).toBe('dying_gasp');
    expect(event.metrics.severity).toBe('critical');
  });

  it('normalizes VSOL GPON Port Down trap scoped to OLT', () => {
    const notification: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.6.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.37950.5.1.2.1',
      receivedAtMs: 1773316800000,
      varbinds: [
        { oid: '1.3.6.1.4.1.37950.5.1.10.1', type: 'Integer', value: 1 },
        { oid: '1.3.6.1.4.1.37950.5.1.10.2', type: 'Integer', value: 3 },
      ],
    };

    const event = executeAdapterSafe(adapter, notification, mockIdentity, mockEvidence);
    expect(event.deviceKind).toBe('OLT');
    expect(event.deviceId).toBe('vsol-v1600-central');
    expect(event.metrics.trapCategory).toBe('pon_down');
    expect(event.metrics.slot).toBe(1);
    expect(event.metrics.port).toBe(3);
    expect(event.metrics.onuId).toBeUndefined();
  });

  it('normalizes VSOL recovery traps with isClear and clearsCategory', () => {
    const onlineNotif: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.6.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.37950.5.1.1.3',
      receivedAtMs: 1773316800000,
      varbinds: [
        { oid: '1.3.6.1.4.1.37950.5.1.10.1', type: 'Integer', value: 1 },
        { oid: '1.3.6.1.4.1.37950.5.1.10.2', type: 'Integer', value: 2 },
        { oid: '1.3.6.1.4.1.37950.5.1.10.3', type: 'Integer', value: 5 },
        { oid: '1.3.6.1.4.1.37950.5.1.10.4', type: 'OctetString', value: 'VSOL12345678' },
      ],
    };

    const onlineEvent = executeAdapterSafe(adapter, onlineNotif, mockIdentity, mockEvidence);
    expect(onlineEvent.metrics.trapCategory).toBe('onu_online');
    expect(onlineEvent.metrics.severity).toBe('info');
    expect(onlineEvent.metrics.isClear).toBe(true);
    expect(onlineEvent.metrics.clearsCategory).toBe('onu_offline');

    const portUpNotif: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.6.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.37950.5.1.2.2',
      receivedAtMs: 1773316800000,
      varbinds: [
        { oid: '1.3.6.1.4.1.37950.5.1.10.1', type: 'Integer', value: 1 },
        { oid: '1.3.6.1.4.1.37950.5.1.10.2', type: 'Integer', value: 3 },
      ],
    };

    const portUpEvent = executeAdapterSafe(adapter, portUpNotif, mockIdentity, mockEvidence);
    expect(portUpEvent.deviceKind).toBe('OLT');
    expect(portUpEvent.metrics.trapCategory).toBe('pon_up');
    expect(portUpEvent.metrics.isClear).toBe(true);
    expect(portUpEvent.metrics.clearsCategory).toBe('pon_down');
  });
});
