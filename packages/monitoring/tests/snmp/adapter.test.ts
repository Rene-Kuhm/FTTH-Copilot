import { describe, expect, it } from 'vitest';
import {
  AdapterSecurityViolationError,
  executeAdapterSafe,
  type OltVendorAdapter,
} from '../../src/snmp/adapter/contract';
import { defaultAdapterRegistry, OltAdapterRegistry } from '../../src/snmp/adapter/registry';
import { StandardOltAdapter } from '../../src/snmp/adapter/standard';
import type { ResolvedDeviceIdentity } from '../../src/snmp/identity';
import type { DecodedSnmpNotification, RawSnmpEvidenceEnvelope } from '../../src/snmp/types';

describe('OLT Vendor Adapter Contract & Standard Adapter', () => {
  const mockIdentity: ResolvedDeviceIdentity = {
    tenantId: 'tenant-100',
    connectionId: 'conn-alpha',
    oltId: 'olt-south-01',
    vendor: 'Standard',
    isStandardTrap: true,
    isAmbiguous: false,
  };

  const mockEvidence: RawSnmpEvidenceEnvelope = {
    evidenceId: 'ev-1',
    receivedAt: '2026-09-10T12:00:00.000Z',
    senderIp: '192.168.10.1',
    senderPort: 162,
    snmpVersion: 'v2c',
    pduType: 'TrapV2',
    trapOid: '1.3.6.1.6.3.1.1.5.3',
    sysUpTime: 12345,
    eventTime: null,
    varbinds: [],
    credentialsRedacted: true,
    fingerprint: 'mock-sha256-fingerprint',
  };

  it('StandardOltAdapter normalizes linkDown with IF-MIB varbinds', () => {
    const adapter = new StandardOltAdapter();
    const notification: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '192.168.10.1',
      senderPort: 162,
      trapOid: '1.3.6.1.6.3.1.1.5.3', // linkDown
      sysUpTime: 12345,
      receivedAtMs: 1773316800000,
      varbinds: [
        { oid: '1.3.6.1.2.1.2.2.1.1.2', type: 'Integer', value: 2 },
        { oid: '1.3.6.1.2.1.2.2.1.7.2', type: 'Integer', value: 1 }, // up
        { oid: '1.3.6.1.2.1.2.2.1.8.2', type: 'Integer', value: 2 }, // down
        { oid: '1.3.6.1.2.1.31.1.1.1.1.2', type: 'OctetString', value: 'ge-0/0/2' },
      ],
    };

    const event = executeAdapterSafe(adapter, notification, mockIdentity, mockEvidence);

    expect(event.schema).toBe('ftth.telemetry.v1');
    expect(event.tenantId).toBe('tenant-100');
    expect(event.deviceId).toBe('olt-south-01');
    expect(event.deviceKind).toBe('OLT');
    expect(event.metrics.trapName).toBe('linkDown');
    expect(event.metrics.trapCategory).toBe('link_down');
    expect(event.metrics.severity).toBe('warning');
    expect(event.metrics.ifIndex).toBe(2);
    expect(event.metrics.ifAdminStatus).toBe('up');
    expect(event.metrics.ifOperStatus).toBe('down');
    expect(event.metrics.ifName).toBe('ge-0/0/2');
    expect(event.tags?.['interface']).toBe('ge-0/0/2');
    expect(event.tags?.['operStatus']).toBe('down');
  });

  it('StandardOltAdapter normalizes authenticationFailure and entConfigChange', () => {
    const adapter = new StandardOltAdapter();

    const authNotification: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '192.168.10.1',
      senderPort: 162,
      trapOid: '1.3.6.1.6.3.1.1.5.5', // authenticationFailure
      receivedAtMs: 1773316800000,
      varbinds: [],
    };

    const authEvent = executeAdapterSafe(adapter, authNotification, mockIdentity, mockEvidence);
    expect(authEvent.metrics.trapName).toBe('authenticationFailure');
    expect(authEvent.metrics.trapCategory).toBe('auth_failure');
    expect(authEvent.metrics.severity).toBe('warning');

    const configNotification: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '192.168.10.1',
      senderPort: 162,
      trapOid: '1.3.6.1.2.1.47.2.0.1', // entConfigChange
      receivedAtMs: 1773316800000,
      varbinds: [],
    };

    const configEvent = executeAdapterSafe(adapter, configNotification, mockIdentity, mockEvidence);
    expect(configEvent.metrics.trapName).toBe('entConfigChange');
    expect(configEvent.metrics.trapCategory).toBe('config_change');
    expect(configEvent.metrics.severity).toBe('info');
  });

  it('enforces Tenant Immutability rejecting adapter attempts to switch tenant', () => {
    const rogueAdapter: OltVendorAdapter = {
      vendorId: 'rogue',
      displayName: 'Rogue Adapter',
      supportedPens: [],
      supportedFamilies: [],
      supports: () => true,
      normalize: (_notif, identity) => ({
        schema: 'ftth.telemetry.v1',
        tenantId: 'malicious-tenant-takeover',
        deviceKind: 'OLT',
        deviceId: identity.oltId,
        source: 'snmp-trap',
        ts: new Date().toISOString(),
        metrics: {},
      }),
    };

    const notification: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '192.168.10.1',
      senderPort: 162,
      trapOid: '1.3.6.1.6.3.1.1.5.3',
      receivedAtMs: Date.now(),
      varbinds: [],
    };

    expect(() =>
      executeAdapterSafe(rogueAdapter, notification, mockIdentity, mockEvidence),
    ).toThrow(AdapterSecurityViolationError);
  });

  it('enforces Severity Bounding preventing inflation of info traps to critical', () => {
    const inflatingAdapter: OltVendorAdapter = {
      vendorId: 'inflator',
      displayName: 'Inflating Adapter',
      supportedPens: [],
      supportedFamilies: [],
      supports: () => true,
      normalize: (_notif, identity) => ({
        schema: 'ftth.telemetry.v1',
        tenantId: identity.tenantId,
        deviceKind: 'OLT',
        deviceId: identity.oltId,
        source: 'snmp-trap',
        ts: new Date().toISOString(),
        metrics: {
          severity: 'critical', // Unjustified inflation of coldStart (info)
        },
      }),
    };

    const notification: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '192.168.10.1',
      senderPort: 162,
      trapOid: '1.3.6.1.6.3.1.1.5.1', // coldStart (catalog severity is 'info')
      receivedAtMs: Date.now(),
      varbinds: [],
    };

    expect(() =>
      executeAdapterSafe(inflatingAdapter, notification, mockIdentity, mockEvidence),
    ).toThrow(AdapterSecurityViolationError);
  });

  it('tags ambiguity and forces Standard adapter on ambiguous identity', () => {
    const registry = new OltAdapterRegistry();
    const dummyHuaweiAdapter: OltVendorAdapter = {
      vendorId: 'huawei',
      displayName: 'Huawei',
      supportedPens: [2011],
      supportedFamilies: ['MA5800'],
      supports: () => true,
      normalize: (_n, id) => ({
        schema: 'ftth.telemetry.v1',
        tenantId: id.tenantId,
        deviceKind: 'OLT',
        deviceId: id.oltId,
        source: 'snmp-trap',
        ts: new Date().toISOString(),
        metrics: { vendor: 'Huawei' },
      }),
    };
    registry.register(dummyHuaweiAdapter);

    const ambiguousIdentity: ResolvedDeviceIdentity = {
      tenantId: 'tenant-100',
      connectionId: 'conn-1',
      oltId: 'olt-conflicted',
      vendor: 'Standard',
      isStandardTrap: false,
      isAmbiguous: true,
      ambiguityReason: 'Vendor conflict',
    };

    const notification: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '192.168.10.1',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.2011.1.2.3',
      receivedAtMs: Date.now(),
      varbinds: [],
    };

    // Registry MUST route ambiguous identity to Standard adapter, not Huawei adapter
    const resolvedAdapter = registry.resolve(notification, ambiguousIdentity);
    expect(resolvedAdapter.vendorId).toBe('standard');

    const event = executeAdapterSafe(
      resolvedAdapter,
      notification,
      ambiguousIdentity,
      mockEvidence,
    );
    expect(event.tags?.['ambiguity_detected']).toBe('true');
    expect(event.tags?.['ambiguity_reason']).toBe('Vendor conflict');
  });
});
