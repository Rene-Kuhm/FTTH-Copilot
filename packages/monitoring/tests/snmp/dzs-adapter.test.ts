import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { executeAdapterSafe } from '../../src/snmp/adapter/contract';
import { DzsOltAdapter } from '../../src/snmp/adapter/dzs';
import { setSimulatorProvisionalTraps } from '../../src/snmp/catalog';
import type { ResolvedDeviceIdentity } from '../../src/snmp/identity';
import type { DecodedSnmpNotification, RawSnmpEvidenceEnvelope } from '../../src/snmp/types';

describe('DZS / Zhone OLT Adapter', () => {
  beforeAll(() => {
    setSimulatorProvisionalTraps(true);
  });

  afterAll(() => {
    setSimulatorProvisionalTraps(false);
  });

  const mockIdentity: ResolvedDeviceIdentity = {
    tenantId: 'tenant-acme',
    connectionId: 'conn-dzs-01',
    oltId: 'mxk-819-core',
    vendor: 'DZS',
    pen: 5504,
    isStandardTrap: false,
    isAmbiguous: false,
  };

  const mockEvidence: RawSnmpEvidenceEnvelope = {
    evidenceId: 'ev-dzs-1',
    receivedAt: '2026-09-15T12:00:00.000Z',
    senderIp: '10.100.5.10',
    senderPort: 162,
    snmpVersion: 'v2c',
    pduType: 'TrapV2',
    trapOid: '1.3.6.1.4.1.5504.5.14.2.1.1',
    sysUpTime: 120500,
    eventTime: null,
    varbinds: [],
    credentialsRedacted: true,
    fingerprint: 'mock-dzs-fingerprint',
  };

  const adapter = new DzsOltAdapter();

  it('supports DZS identity, PEN 5504/6296/5597, and Zhone OIDs, rejecting ambiguous identities', () => {
    const notification: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.5.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.5504.5.14.2.1.1',
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

  it('supports Zhone vendor name as alternative to DZS', () => {
    const zhoneIdentity: ResolvedDeviceIdentity = {
      ...mockIdentity,
      vendor: 'Zhone',
    };
    const notification: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.5.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.5504.5.14.2.1.1',
      receivedAtMs: 1773316800000,
      varbinds: [],
    };
    expect(adapter.supports(notification, zhoneIdentity)).toBe(true);
  });

  it('normalizes ONT dying gasp trap with serial and hierarchy from varbinds', () => {
    const notification: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.5.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.5504.5.14.2.1.1.1.2.3.4.5',
      receivedAtMs: 1773316800000,
      varbinds: [
        {
          oid: '1.3.6.1.4.1.5504.5.14.1.1.1',
          type: 'OctetString',
          value: 'DZSA12345678',
        },
      ],
    };

    const event = executeAdapterSafe(adapter, notification, mockIdentity, mockEvidence);

    expect(event.schema).toBe('ftth.telemetry.v1');
    expect(event.tenantId).toBe('tenant-acme');
    expect(event.deviceKind).toBe('ONU');
    expect(event.deviceId).toBe('DZSA12345678');
    expect(event.metrics.serial).toBe('DZSA12345678');
    expect(event.metrics.severity).toBe('critical');
    expect(event.metrics.trapCategory).toBe('dying_gasp');
    expect(event.tags?.['serial']).toBe('DZSA12345678');
    expect(event.tags?.['vendor']).toBe('DZS');
  });

  it('normalizes PON port down trap with deviceKind: OLT', () => {
    const notification: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.5.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.5504.5.14.2.1.20',
      receivedAtMs: 1773316800000,
      varbinds: [],
    };

    const event = executeAdapterSafe(adapter, notification, mockIdentity, mockEvidence);
    expect(event.deviceKind).toBe('OLT');
    expect(event.deviceId).toBe('mxk-819-core');
    expect(event.metrics.trapCategory).toBe('pon_down');
    expect(event.metrics.severity).toBe('critical');
  });

  it('handles los_clear as clear event', () => {
    const notification: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.5.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.5504.5.14.2.1.12',
      receivedAtMs: 1773316800000,
      varbinds: [
        { oid: '1.3.6.1.4.1.5504.5.14.1.1.1', type: 'OctetString', value: 'DZSA12345678' },
      ],
    };

    const event = executeAdapterSafe(adapter, notification, mockIdentity, mockEvidence);
    expect(event.metrics.isClear).toBe(true);
    expect(event.metrics.clearsCategory).toBe('los');
  });
});
