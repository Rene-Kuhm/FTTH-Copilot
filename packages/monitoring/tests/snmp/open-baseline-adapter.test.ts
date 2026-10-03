import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { executeAdapterSafe } from '../../src/snmp/adapter/contract';
import { OpenBaselineOltAdapter } from '../../src/snmp/adapter/open-baseline';
import { OltAdapterRegistry } from '../../src/snmp/adapter/registry';
import { StandardOltAdapter } from '../../src/snmp/adapter/standard';
import { GenericXponAdapter } from '../../src/snmp/adapter/generic-xpon';
import { setSimulatorProvisionalTraps } from '../../src/snmp/catalog';
import type { ResolvedDeviceIdentity } from '../../src/snmp/identity';
import type { DecodedSnmpNotification, RawSnmpEvidenceEnvelope } from '../../src/snmp/types';

function identity(over: Partial<ResolvedDeviceIdentity> = {}): ResolvedDeviceIdentity {
  return {
    tenantId: 'tenant-baseline',
    connectionId: 'conn-baseline-01',
    oltId: 'olt-baseline-01',
    vendor: 'Zyxel',
    pen: 890,
    isStandardTrap: false,
    isAmbiguous: false,
    ...over,
  };
}

const evidence: RawSnmpEvidenceEnvelope = {
  evidenceId: 'ev-base-1',
  receivedAt: '2026-10-02T12:00:00.000Z',
  senderIp: '10.100.9.10',
  senderPort: 162,
  snmpVersion: 'v2c',
  pduType: 'TrapV2',
  trapOid: '1.3.6.1.4.1.890.0.0.1',
  sysUpTime: 1000,
  eventTime: null,
  varbinds: [],
  credentialsRedacted: true,
  fingerprint: 'mock-baseline-fingerprint',
};

function notification(
  trapOid: string,
  varbinds: DecodedSnmpNotification['varbinds'] = [],
): DecodedSnmpNotification {
  return {
    version: 'v2c',
    pduType: 'TrapV2',
    senderIp: '10.100.9.10',
    senderPort: 162,
    trapOid,
    receivedAtMs: 1773316800000,
    varbinds,
  };
}

const adapter = new OpenBaselineOltAdapter();

describe('Open Baseline OLT Adapter', () => {
  beforeAll(() => setSimulatorProvisionalTraps(true));
  afterAll(() => setSimulatorProvisionalTraps(false));
  describe('supports()', () => {
    const n = notification('1.3.6.1.4.1.890.0.0.1');

    it('accepts every registered baseline vendor by name', () => {
      for (const vendor of [
        'Zyxel',
        'C-Data',
        'Cdata',
        'Ericsson',
        'Raisecom',
        'Edgecore',
        'Accton',
        'Cisco',
      ]) {
        expect(adapter.supports(n, identity({ vendor, pen: undefined })), vendor).toBe(true);
      }
    });

    it('accepts every registered baseline vendor by PEN', () => {
      for (const pen of [9, 890, 1931, 34592, 34595, 40418]) {
        expect(adapter.supports(n, identity({ vendor: 'Unknown', pen })), `PEN ${pen}`).toBe(true);
      }
    });

    it('rejects ambiguous identities even for a known vendor', () => {
      const amb = identity({ isAmbiguous: true, ambiguityReason: 'sender mismatch' });
      expect(adapter.supports(n, amb)).toBe(false);
    });

    it('rejects vendors that own a public alarm MIB', () => {
      for (const [vendor, pen] of [
        ['Huawei', 2011],
        ['ZTE', 3902],
        ['Nokia', 637],
        ['DZS', 5504],
      ] as const) {
        expect(adapter.supports(n, identity({ vendor, pen })), vendor).toBe(false);
      }
    });
  });

  describe('normalize() scope classification', () => {
    it('reports OLT scope for pon_down and never derives an ONU id from it', () => {
      // hwGponPortDown is a registered catalog entry; the baseline adapter must
      // keep it OLT-scoped even though the vendor has no MIB of its own.
      const n = notification('1.3.6.1.4.1.2011.6.128.1.1.2.43.20', [
        { oid: '1.3.6.1.4.1.2011.6.128.1.1.1', type: 'OctetString', value: 'HWTC12345678' },
      ]);
      const ev = executeAdapterSafe(adapter, n, identity(), evidence);

      expect(ev.deviceKind).toBe('OLT');
      expect(ev.deviceId).toBe('olt-baseline-01');
      expect(ev.metrics.trapCategory).toBe('pon_down');
    });

    it('reports ONU scope for los and attaches the decoded serial', () => {
      const n = notification('1.3.6.1.4.1.2011.6.128.1.1.2.43.1', [
        { oid: '1.3.6.1.4.1.2011.6.128.1.1.1', type: 'OctetString', value: 'ZTEGC8765432' },
      ]);
      const ev = executeAdapterSafe(adapter, n, identity(), evidence);

      expect(ev.deviceKind).toBe('ONU');
      expect(ev.deviceId).toBe('ZTEGC8765432');
      expect(ev.metrics.serial).toBe('ZTEGC8765432');
      expect(ev.metrics.trapCategory).toBe('los');
    });

    it('keeps dying_gasp ONU-scoped', () => {
      const n = notification('1.3.6.1.4.1.2011.6.128.1.1.2.43.2', [
        { oid: '1.3.6.1.4.1.2011.6.128.1.1.1', type: 'OctetString', value: 'ZTEGC8765432' },
      ]);
      const ev = executeAdapterSafe(adapter, n, identity(), evidence);

      expect(ev.deviceKind).toBe('ONU');
      expect(ev.metrics.trapCategory).toBe('dying_gasp');
    });

    it('falls back to unknown_trap for an unregistered OID without inventing a category', () => {
      const n = notification('1.3.6.1.4.1.890.55.1.2.3');
      const ev = executeAdapterSafe(adapter, n, identity(), evidence);

      expect(ev.metrics.trapCategory).toBe('unknown_trap');
      expect(ev.metrics.severity).toBe('info');
      expect(ev.deviceKind).toBe('OLT');
    });
  });

  describe('IF-MIB context', () => {
    it('carries ifIndex, ifName, ifOperStatus and ifAlias into metrics and tags', () => {
      const n = notification('1.3.6.1.4.1.890.55.1.2.3', [
        { oid: '1.3.6.1.2.1.2.2.1.1.7', type: 'Integer32', value: 7 },
        { oid: '1.3.6.1.2.1.2.2.1.2.7', type: 'OctetString', value: 'pon0/0/1' },
        { oid: '1.3.6.1.2.1.31.1.1.1.1.7', type: 'OctetString', value: 'eth0' },
        { oid: '1.3.6.1.2.1.2.2.1.8.7', type: 'Integer32', value: 1 },
        { oid: '1.3.6.1.2.1.31.1.1.1.18.7', type: 'OctetString', value: 'pon-0/0/1' },
      ]);
      const ev = executeAdapterSafe(adapter, n, identity(), evidence);

      expect(ev.metrics.ifIndex).toBe(7);
      expect(ev.metrics.ifDescr).toBe('pon0/0/1');
      expect(ev.metrics.ifName).toBe('eth0');
      expect(ev.metrics.ifOperStatus).toBe('up');
      expect(ev.metrics.ifAlias).toBe('pon-0/0/1');
      expect(ev.tags?.interface).toBe('eth0');
      expect(ev.tags?.operStatus).toBe('up');
    });
  });

  describe('provenance honesty', () => {
    it('marks every event as baseline coverage, never as vendor-MIB derived', () => {
      const n = notification('1.3.6.1.4.1.890.55.1.2.3');
      const ev = executeAdapterSafe(adapter, n, identity(), evidence);

      expect(ev.metrics.coverage).toBe('baseline');
      expect(ev.metrics.interpretation).toBe('standards-only');
      expect(ev.tags?.coverage).toBe('baseline');
    });

    it('resolves the vendor name from the PEN when the agent reports none', () => {
      const n = notification('1.3.6.1.4.1.34595.1.1');
      const ev = executeAdapterSafe(adapter, n, identity({ vendor: '', pen: 34595 }), evidence);

      // metrics.vendor is adapter-derived. tags.vendor is intentionally left to
      // the execution harness, which stamps the agent-reported identity.
      expect(ev.metrics.vendor).toBe('Raisecom');
      expect(ev.metrics.vendor).not.toBe('Unknown');
    });
  });

  describe('registry precedence', () => {
    it('resolves a baseline vendor to this adapter instead of the standard fallback', () => {
      const registry = new OltAdapterRegistry();
      registry.register(adapter);
      const n = notification('1.3.6.1.4.1.890.55.1.2.3');

      const resolved = registry.resolve(n, identity());
      expect(resolved).toBe(adapter);
    });

    it('still falls back to standard for a vendor outside the baseline set', () => {
      const registry = new OltAdapterRegistry();
      registry.register(adapter);
      const n = notification('1.3.6.1.4.1.2011.6.128.1.1.2.43.20');

      const resolved = registry.resolve(n, identity({ vendor: 'Huawei', pen: 2011 }));
      expect(resolved).not.toBe(adapter);
      expect(resolved).toBeInstanceOf(StandardOltAdapter);
    });

    it('leaves generic_xpon identities to the generic adapter', () => {
      const registry = new OltAdapterRegistry();
      registry.register(adapter);
      registry.register(new GenericXponAdapter());
      const n = notification('1.3.6.1.4.1.99999.1.1.1');

      const resolved = registry.resolve(n, identity({ vendor: 'generic_xpon', pen: undefined }));
      expect(resolved).toBeInstanceOf(GenericXponAdapter);
    });
  });
});
