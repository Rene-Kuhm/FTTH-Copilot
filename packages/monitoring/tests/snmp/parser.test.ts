import { describe, expect, it } from 'vitest';
import { telemetryEventSchema } from '@ftth-copilot/shared';
import {
  parseAndNormalizeSnmpTrap,
  type RawSnmpTrapPacket,
} from '../../src/snmp/parser';
import { setSimulatorProvisionalTraps } from '../../src/snmp/catalog';
import type { SnmpSenderContext } from '../../src/snmp/mapping';

describe('SNMP Trap Parser & Normalizer (Roadmap Fase 6 — 6.3 + 6.4)', () => {
  const senderContext: SnmpSenderContext = {
    tenantId: 'tenant-isp-1',
    connectionId: 'conn-olt-1',
    oltId: 'OLT-NORTH-1',
    vendor: 'Huawei',
  };

  it('suppresses provisional Huawei Dying Gasp trap to unknown_trap (info) with catalogStatus provisional by default', () => {
    setSimulatorProvisionalTraps(false);
    const packet: RawSnmpTrapPacket = {
      version: 'v2c',
      community: 'public',
      trapOid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.2', // hwGponOntDyingGasp (provisional)
      varbinds: [
        { oid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.1.1', value: 1 },
        { oid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.1.2', value: 3 },
        { oid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.1.3', value: 15 },
        { oid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.1.4', value: 'HWTC12345678' },
      ],
      receivedAtMs: 1757500000000,
    };

    const event = parseAndNormalizeSnmpTrap(packet, senderContext);
    const parseResult = telemetryEventSchema.safeParse(event);
    expect(parseResult.success).toBe(true);

    expect(event.metrics.snmpTrapOid).toBe('1.3.6.1.4.1.2011.6.128.1.1.2.43.2');
    expect(event.metrics.trapCategory).toBe('unknown_trap');
    expect(event.metrics.trapName).toBe('provisionalTrap');
    expect(event.metrics.candidateTrapName).toBe('hwGponOntDyingGasp');
    expect(event.metrics.candidateDescription).toBe(
      'Power failure / dying gasp alarm sent by GPON ONT',
    );
    expect(event.metrics.description).toBe(
      'Provisional unverified SNMP trap OID awaiting physical lab confirmation',
    );
    expect(event.metrics.severity).toBe('info');
    expect(event.metrics.catalogStatus).toBe('provisional');
    expect(event.tags?.['catalogStatus']).toBe('provisional');
  });

  it('normalizes a provisional Huawei Dying Gasp trap with ONU varbinds into TelemetryEvent when simulator mode is enabled', () => {
    setSimulatorProvisionalTraps(true);
    const packet: RawSnmpTrapPacket = {
      version: 'v2c',
      community: 'public',
      trapOid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.2', // hwGponOntDyingGasp
      varbinds: [
        { oid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.1.1', value: 1 }, // slot
        { oid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.1.2', value: 3 }, // port
        { oid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.1.3', value: 15 }, // onuId
        { oid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.1.4', value: 'HWTC12345678' }, // sn
      ],
      receivedAtMs: 1757500000000,
    };

    const event = parseAndNormalizeSnmpTrap(packet, senderContext);

    // Validate strictly against canonical telemetryEventSchema
    const parseResult = telemetryEventSchema.safeParse(event);
    expect(parseResult.success).toBe(true);

    expect(event.schema).toBe('ftth.telemetry.v1');
    expect(event.tenantId).toBe('tenant-isp-1');
    expect(event.source).toBe('snmp-trap');
    expect(event.deviceKind).toBe('ONU');
    expect(event.deviceId).toContain('HWTC12345678');
    expect(event.metrics.snmpTrapOid).toBe('1.3.6.1.4.1.2011.6.128.1.1.2.43.2');
    expect(event.metrics.trapCategory).toBe('dying_gasp');
    expect(event.metrics.severity).toBe('critical');
    expect(event.tags?.connectionId).toBe('conn-olt-1');
    setSimulatorProvisionalTraps(false);
  });

  it('normalizes a standard RFC linkDown trap on an OLT port', () => {
    const packet: RawSnmpTrapPacket = {
      version: 'v2c',
      community: 'public',
      trapOid: '1.3.6.1.6.3.1.1.5.3', // linkDown
      varbinds: [
        { oid: '1.3.6.1.2.1.2.2.1.1', value: 101 }, // ifIndex
        { oid: '1.3.6.1.2.1.2.2.1.2', value: 'GigabitEthernet0/0/1' }, // ifDescr
        { oid: '1.3.6.1.2.1.2.2.1.8', value: 2 }, // ifOperStatus down
      ],
      receivedAtMs: 1757500000000,
    };

    const event = parseAndNormalizeSnmpTrap(packet, senderContext);
    const parseResult = telemetryEventSchema.safeParse(event);
    expect(parseResult.success).toBe(true);

    expect(event.deviceKind).toBe('OLT');
    expect(event.deviceId).toBe('OLT-NORTH-1');
    expect(event.metrics.snmpTrapOid).toBe('1.3.6.1.6.3.1.1.5.3');
    expect(event.metrics.trapCategory).toBe('link_down');
    expect(event.metrics.severity).toBe('warning');
  });

  it('safely normalizes unknown OID as unknown_trap without fabricating diagnostics (6.4)', () => {
    const packet: RawSnmpTrapPacket = {
      version: 'v2c',
      community: 'public',
      trapOid: '1.3.6.1.4.1.99999.0.99', // Unknown vendor OID
      varbinds: [{ oid: '1.3.6.1.4.1.99999.0.99.1', value: 'Some opaque vendor payload' }],
      receivedAtMs: 1757500000000,
    };

    const event = parseAndNormalizeSnmpTrap(packet, senderContext);
    const parseResult = telemetryEventSchema.safeParse(event);
    expect(parseResult.success).toBe(true);

    expect(event.metrics.trapCategory).toBe('unknown_trap');
    expect(event.metrics.severity).toBe('info');
    expect(event.metrics.snmpTrapOid).toBe('1.3.6.1.4.1.99999.0.99');
    expect(event.deviceKind).toBe('OLT');
    expect(event.deviceId).toBe('OLT-NORTH-1');
  });
});
