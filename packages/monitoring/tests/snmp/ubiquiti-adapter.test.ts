import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { executeAdapterSafe } from '../../src/snmp/adapter/contract';
import { UbiquitiOltAdapter } from '../../src/snmp/adapter/ubiquiti';
import { setSimulatorProvisionalTraps } from '../../src/snmp/catalog';
import type { ResolvedDeviceIdentity } from '../../src/snmp/identity';
import type { DecodedSnmpNotification, RawSnmpEvidenceEnvelope } from '../../src/snmp/types';

describe('Ubiquiti / UISP OLT Adapter', () => {
  beforeAll(() => {
    setSimulatorProvisionalTraps(true);
  });

  afterAll(() => {
    setSimulatorProvisionalTraps(false);
  });

  const mockIdentity: ResolvedDeviceIdentity = {
    tenantId: 'tenant-acme',
    connectionId: 'conn-ufiber-01',
    oltId: 'ufiber-edge-01',
    vendor: 'Ubiquiti',
    pen: 41112,
    isStandardTrap: false,
    isAmbiguous: false,
  };

  const mockEvidence: RawSnmpEvidenceEnvelope = {
    evidenceId: 'ev-ubiquiti-1',
    receivedAt: '2026-09-15T12:00:00.000Z',
    senderIp: '10.100.7.10',
    senderPort: 162,
    snmpVersion: 'v2c',
    pduType: 'TrapV2',
    trapOid: '1.3.6.1.4.1.41112.1.5.1.1.0',
    sysUpTime: 120500,
    eventTime: null,
    varbinds: [],
    credentialsRedacted: true,
    fingerprint: 'mock-ubiquiti-fingerprint',
  };

  const adapter = new UbiquitiOltAdapter();

  it('supports Ubiquiti identity, PEN 41112, and UFiber OIDs, rejecting ambiguous identities', () => {
    const notification: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.7.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.41112.1.5.1.1.0',
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

  it('supports UI vendor name as alternative to Ubiquiti', () => {
    const uiIdentity: ResolvedDeviceIdentity = {
      ...mockIdentity,
      vendor: 'UI',
    };
    const notification: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.7.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.41112.1.5.1.1.0',
      receivedAtMs: 1773316800000,
      varbinds: [],
    };
    expect(adapter.supports(notification, uiIdentity)).toBe(true);
  });

  it('normalizes ONT offline trap as ONU scope event', () => {
    const notification: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.7.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.41112.1.5.1.1.0',
      receivedAtMs: 1773316800000,
      varbinds: [
        { oid: '1.3.6.1.4.1.41112.1.5.1.1.0.1', type: 'OctetString', value: 'UBNT12345678' },
      ],
    };

    const event = executeAdapterSafe(adapter, notification, mockIdentity, mockEvidence);

    expect(event.schema).toBe('ftth.telemetry.v1');
    expect(event.tenantId).toBe('tenant-acme');
    expect(event.deviceKind).toBe('ONU');
    expect(event.metrics.trapCategory).toBe('onu_offline');
    expect(event.metrics.severity).toBe('warning');
    expect(event.tags?.['vendor']).toBe('Ubiquiti');
  });

  it('normalizes PON port down trap with deviceKind: OLT', () => {
    const notification: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.7.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.41112.1.5.2.1.0',
      receivedAtMs: 1773316800000,
      varbinds: [],
    };

    const event = executeAdapterSafe(adapter, notification, mockIdentity, mockEvidence);
    expect(event.deviceKind).toBe('OLT');
    expect(event.deviceId).toBe('ufiber-edge-01');
    expect(event.metrics.trapCategory).toBe('pon_down');
    expect(event.metrics.severity).toBe('critical');
  });

  it('handles ont_online as clear event for onu_offline', () => {
    const notification: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.7.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.41112.1.5.1.2.0',
      receivedAtMs: 1773316800000,
      varbinds: [],
    };

    const event = executeAdapterSafe(adapter, notification, mockIdentity, mockEvidence);
    expect(event.metrics.isClear).toBe(true);
    expect(event.metrics.clearsCategory).toBe('onu_offline');
  });
});
