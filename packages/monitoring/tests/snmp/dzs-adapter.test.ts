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

  // ── Regression: ODN identifiers must never be mistaken for ONT serials ──
  //
  // The previous scanner matched any varbind whose OID contained the bare
  // `5504.5.14` subtree and whose value was 8+ characters. That subtree also
  // carries ODN identifiers, so `CTO-NORTE-12` was reported as `deviceId` for
  // ONU-scoped events. The loop also had no early exit, so a trailing ODN
  // varbind overwrote a genuine serial that appeared earlier.

  it('does not treat an ODN identifier as an ONT serial', () => {
    const notification: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.5.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.5504.5.14.2.1.2',
      receivedAtMs: 1773316800000,
      varbinds: [
        { oid: '1.3.6.1.4.1.5504.5.14.1.1.1', type: 'OctetString', value: 'CTO-NORTE-12' },
      ],
    };

    const event = executeAdapterSafe(adapter, notification, mockIdentity, mockEvidence);

    // The ODN identifier is rejected as a serial, so the event falls back to a
    // positional id derived from the ONT index instance rather than to the CTO.
    expect(event.deviceId).not.toBe('CTO-NORTE-12');
    expect(event.metrics.serial).toBeUndefined();
    expect(event.deviceKind).toBe('ONU');
    expect(event.deviceId).toBe('mxk-819-core:onu:0/0/0/1');
  });

  it('keeps the first valid serial when a later varbind looks serial-like', () => {
    const notification: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.5.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.5504.5.14.2.1.2',
      receivedAtMs: 1773316800000,
      varbinds: [
        { oid: '1.3.6.1.4.1.5504.5.14.1.1.1', type: 'OctetString', value: 'DZSA12345678' },
        { oid: '1.3.6.1.4.1.5504.5.14.10.50.1', type: 'OctetString', value: 'NAP-CENTRO-01' },
      ],
    };

    const event = executeAdapterSafe(adapter, notification, mockIdentity, mockEvidence);

    expect(event.deviceId).toBe('DZSA12345678');
    expect(event.metrics.serial).toBe('DZSA12345678');
  });

  it('does not invent frame/slot/port from an arbitrary subtree OID', () => {
    const notification: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.5.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.5504.5.14.2.1.2',
      receivedAtMs: 1773316800000,
      varbinds: [
        { oid: '1.3.6.1.4.1.5504.5.14.1.1.1', type: 'OctetString', value: 'DZSA12345678' },
        // Not the documented ONT index column, so no hierarchy is derived.
        { oid: '1.3.6.1.4.1.5504.5.14.99.1.2.3', type: 'OctetString', value: 'x' },
      ],
    };

    const event = executeAdapterSafe(adapter, notification, mockIdentity, mockEvidence);

    expect(event.metrics.frame).toBeUndefined();
    expect(event.metrics.slot).toBeUndefined();
    expect(event.metrics.port).toBeUndefined();
  });

  it('derives frame/slot/port/onuId only from the documented ONT index column', () => {
    const notification: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.5.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.5504.5.14.2.1.2',
      receivedAtMs: 1773316800000,
      varbinds: [
        { oid: '1.3.6.1.4.1.5504.5.14.1.1.1.2.3.4.5', type: 'OctetString', value: 'DZSA12345678' },
      ],
    };

    const event = executeAdapterSafe(adapter, notification, mockIdentity, mockEvidence);

    expect(event.metrics.frame).toBe(2);
    expect(event.metrics.slot).toBe(3);
    expect(event.metrics.port).toBe(4);
    expect(event.metrics.onuId).toBe(5);
    expect(event.deviceId).toBe('DZSA12345678');
  });
});
