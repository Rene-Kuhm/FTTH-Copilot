import { describe, expect, it } from 'vitest';
import { executeAdapterSafe } from '../../src/snmp/adapter/contract';
import { GenericXponAdapter } from '../../src/snmp/adapter/generic-xpon';
import type { ResolvedDeviceIdentity } from '../../src/snmp/identity';
import type { DecodedSnmpNotification, RawSnmpEvidenceEnvelope } from '../../src/snmp/types';

describe('Generic xPON Fallback Adapter (Roadmap Fase 6)', () => {
  const mockIdentity: ResolvedDeviceIdentity = {
    tenantId: 'tenant-generic-isp',
    connectionId: 'conn-generic-01',
    oltId: 'olt-generic-01',
    vendor: 'Generic',
    isStandardTrap: false,
    isAmbiguous: false,
  };

  const mockEvidence: RawSnmpEvidenceEnvelope = {
    evidenceId: 'ev-gen-1',
    receivedAt: '2026-09-10T12:00:00.000Z',
    senderIp: '10.100.8.10',
    senderPort: 162,
    snmpVersion: 'v2c',
    pduType: 'TrapV2',
    trapOid: '1.3.6.1.4.1.99999.1.1.1',
    sysUpTime: 123456,
    eventTime: null,
    varbinds: [],
    credentialsRedacted: true,
    fingerprint: 'mock-generic-fingerprint',
  };

  const adapter = new GenericXponAdapter();

  it('supports generic, generic_xpon, and xpon identities', () => {
    const notification: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.8.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.99999.1.1.1',
      receivedAtMs: 1773316800000,
      varbinds: [],
    };

    expect(adapter.supports(notification, mockIdentity)).toBe(true);

    const specificIdentity: ResolvedDeviceIdentity = {
      ...mockIdentity,
      vendor: 'Huawei',
    };
    expect(adapter.supports(notification, specificIdentity)).toBe(false);
  });

  it('normalizes unknown xPON trap with standard IF-MIB metrics and OLT scope', () => {
    const notification: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.8.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.99999.1.1.1',
      receivedAtMs: 1773316800000,
      varbinds: [
        { oid: '1.3.6.1.2.1.2.2.1.1.10', type: 'Integer', value: 10 },
        { oid: '1.3.6.1.2.1.2.2.1.2.10', type: 'OctetString', value: 'gpon-olt 1/1' },
      ],
    };

    const event = executeAdapterSafe(adapter, notification, mockIdentity, mockEvidence);
    expect(event.schema).toBe('ftth.telemetry.v1');
    expect(event.tenantId).toBe('tenant-generic-isp');
    expect(event.deviceKind).toBe('OLT');
    expect(event.deviceId).toBe('olt-generic-01');
    expect(event.tags?.['adapter']).toBe('generic_xpon');
    expect(event.metrics.ifIndex).toBe(10);
    expect(event.metrics.ifDescr).toBe('gpon-olt 1/1');
  });

  it('scopes to ONU if varbind contains valid GPON serial number', () => {
    const notification: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.8.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.99999.1.1.2',
      receivedAtMs: 1773316800000,
      varbinds: [
        { oid: '1.3.6.1.4.1.99999.1.1.2.1', type: 'OctetString', value: 'HWTC99887766' },
      ],
    };

    const event = executeAdapterSafe(adapter, notification, mockIdentity, mockEvidence);
    expect(event.deviceKind).toBe('ONU');
    expect(event.deviceId).toBe('HWTC99887766');
    expect(event.metrics.serial).toBe('HWTC99887766');
    expect(event.tags?.['serial']).toBe('HWTC99887766');
  });
});
