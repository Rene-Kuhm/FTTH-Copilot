import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { executeAdapterSafe } from '../../src/snmp/adapter/contract';
import { UbiquitiOltAdapter } from '../../src/snmp/adapter/ubiquiti';
import { setSimulatorProvisionalTraps } from '../../src/snmp/catalog';
import type { ResolvedDeviceIdentity } from '../../src/snmp/identity';
import type { DecodedSnmpNotification, RawSnmpEvidenceEnvelope } from '../../src/snmp/types';

/**
 * Device extraction for the Ubiquiti adapter, the weakest vendor adapter by
 * coverage at 74%. Two things are asserted here.
 *
 * The ifIndex-to-PON-port mapping, where `metrics.ifIndex` is the raw value and
 * only `tags.port` is range-filtered, so a trap on a non-PON interface must not
 * claim a port.
 *
 * And the serial extraction, which does not work: the adapter matches the
 * literal words 'serial', 'onu' or 'gpon' inside the varbind OID, but the
 * decoder emits numeric OIDs like 1.3.6.1.4.1.41112..., which never contain
 * those words. The branch is unreachable, so every ONU on an OLT collapses onto
 * the same deviceId. These tests pin the current behaviour rather than pretend
 * it works, so the gap is visible if the matching is ever repaired.
 */
describe('Ubiquiti device extraction', () => {
  beforeAll(() => setSimulatorProvisionalTraps(true));
  afterAll(() => setSimulatorProvisionalTraps(false));

  const adapter = new UbiquitiOltAdapter();

  const identity: ResolvedDeviceIdentity = {
    tenantId: 'tenant-acme',
    connectionId: 'conn-ufiber-01',
    oltId: 'ufiber-edge-01',
    vendor: 'Ubiquiti',
    pen: 41112,
    isStandardTrap: false,
    isAmbiguous: false,
  };

  const TRAP_OID = '1.3.6.1.4.1.41112.1.5.1.1.0';
  const IF_INDEX_OID = '1.3.6.1.2.1.2.2.1.1';

  function notification(varbinds: Array<{ oid: string; value: unknown }>) {
    return {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.7.10',
      senderPort: 162,
      trapOid: TRAP_OID,
      receivedAtMs: 1773316800000,
      varbinds,
    } as DecodedSnmpNotification;
  }

  function evidence(): RawSnmpEvidenceEnvelope {
    return {
      evidenceId: 'ev-ubq-1',
      receivedAt: '2026-09-15T12:00:00.000Z',
      senderIp: '10.100.7.10',
      senderPort: 162,
      snmpVersion: 'v2c',
      pduType: 'TrapV2',
      trapOid: TRAP_OID,
      sysUpTime: 120500,
      eventTime: null,
      varbinds: [],
      credentialsRedacted: true,
      fingerprint: 'fp-ubq',
    };
  }

  function parse(varbinds: Array<{ oid: string; value: unknown }>) {
    return executeAdapterSafe(adapter, notification(varbinds), identity, evidence());
  }

  describe('ifIndex to PON port', () => {
    it.each([1, 2, 8])('claims ifIndex %i as a PON port', (ifIndex) => {
      const event = parse([{ oid: IF_INDEX_OID, value: ifIndex }]);

      expect(event.metrics['ifIndex']).toBe(ifIndex);
      expect(event.tags['port']).toBe(String(ifIndex));
    });

    it('keeps the raw ifIndex but claims no port when it is outside the range', () => {
      const event = parse([{ oid: IF_INDEX_OID, value: 40 }]);

      // The raw value is still reported for diagnostics...
      expect(event.metrics['ifIndex']).toBe(40);
      // ...but it must not be presented as a PON port.
      expect(event.tags['port']).toBeUndefined();
    });

    it('claims no port for ifIndex 0', () => {
      const event = parse([{ oid: IF_INDEX_OID, value: 0 }]);

      expect(event.metrics['ifIndex']).toBe(0);
      expect(event.tags['port']).toBeUndefined();
    });

    it('omits both when no interface varbind is present', () => {
      const event = parse([]);

      expect(event.metrics['ifIndex']).toBeUndefined();
      expect(event.tags['port']).toBeUndefined();
    });
  });

  describe('serial extraction, currently unreachable', () => {
    it('does not pick up a serial from a numeric varbind', () => {
      // KNOWN GAP: the adapter looks for the words 'serial', 'onu' or 'gpon'
      // inside the varbind OID, which is numeric in every real trap.
      const event = parse([{ oid: '1.3.6.1.4.1.41112.1.5.1.2.1.0', value: 'HWTC12345678' }]);

      expect(event.deviceId).toBe('ufiber-edge-01:onu:0/0');
    });

    it('collapses every ONU of the OLT onto the same device id', () => {
      // The operational consequence: two different ONUs reporting a fault are
      // indistinguishable, so a NOC cannot tell which one dropped.
      const first = parse([
        { oid: '1.3.6.1.4.1.41112.1.5.1.2.1.0', value: 'HWTCAAAAAAAA' },
      ]);
      const second = parse([
        { oid: '1.3.6.1.4.1.41112.1.5.1.2.1.0', value: 'HWTCBBBBBBBB' },
      ]);

      expect(first.deviceId).toBe(second.deviceId);
    });

    it('would pick it up if the OID were ever symbolic', () => {
      // Guards the intent: given a symbolic OID the branch does fire, so the
      // only thing missing is that real traps are numeric.
      const event = parse([{ oid: 'ponSerialNumber', value: 'HWTC12345678' }]);

      expect(event.deviceId).toContain('HWTC12345678');
    });
  });

  describe('contract invariants', () => {
    it('keeps the tenant from the identity, never from the payload', () => {
      const event = parse([{ oid: IF_INDEX_OID, value: 2 }]);
      expect(event.tenantId).toBe(identity.tenantId);
    });

    it('is deterministic for identical input', () => {
      const varbinds = [
        { oid: '1.3.6.1.4.1.41112.1.5.1.2.1.0', value: 'HWTCAAAAAAAA' },
        { oid: '1.3.6.1.4.1.41112.1.5.1.3.1.0', value: 'HWTCBBBBBBBB' },
      ];

      expect(parse(varbinds).deviceId).toBe(parse(varbinds).deviceId);
    });

    it('reports the vendor id used for registry lookup', () => {
      expect(adapter.vendorId.toLowerCase()).toBe('ubiquiti');
    });

    it('supports a matching identity and refuses an ambiguous one', () => {
      expect(adapter.supports(notification([]), identity)).toBe(true);
      expect(
        adapter.supports(notification([]), { ...identity, isAmbiguous: true }),
      ).toBe(false);
    });
  });
});