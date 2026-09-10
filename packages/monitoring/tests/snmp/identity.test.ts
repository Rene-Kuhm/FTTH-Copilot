import { describe, expect, it } from 'vitest';
import { resolveDeviceIdentity } from '../../src/snmp/identity';
import type { SnmpSenderContext } from '../../src/snmp/mapping';

describe('Multi-Source Device Identity & Ambiguity Resolution', () => {
  const baseContext: SnmpSenderContext = {
    tenantId: 'tenant-acme',
    connectionId: 'conn-1',
    oltId: 'olt-main',
    vendor: 'Huawei',
  };

  it('resolves consistent Huawei enterprise trap and preserves tenant isolation', () => {
    const notification = {
      trapOid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.1', // Huawei GPON LOS
      varbinds: [],
    };

    const identity = resolveDeviceIdentity(notification, baseContext);
    expect(identity.tenantId).toBe('tenant-acme');
    expect(identity.oltId).toBe('olt-main');
    expect(identity.vendor).toBe('Huawei');
    expect(identity.pen).toBe(2011);
    expect(identity.isStandardTrap).toBe(false);
    expect(identity.isAmbiguous).toBe(false);
  });

  it('resolves standard RFC linkDown trap, retaining registered vendor', () => {
    const notification = {
      trapOid: '1.3.6.1.6.3.1.1.5.3', // Standard linkDown
      varbinds: [],
    };

    const identity = resolveDeviceIdentity(notification, baseContext);
    expect(identity.tenantId).toBe('tenant-acme');
    expect(identity.vendor).toBe('Huawei');
    expect(identity.isStandardTrap).toBe(true);
    expect(identity.isAmbiguous).toBe(false);
  });

  it('rejects ambiguity when sender is registered as Huawei but trap OID belongs to ZTE', () => {
    const notification = {
      trapOid: '1.3.6.1.4.1.3902.1082.500.10.2.2.1', // ZTE GPON LOS
      varbinds: [],
    };

    const identity = resolveDeviceIdentity(notification, baseContext);
    expect(identity.tenantId).toBe('tenant-acme');
    expect(identity.isAmbiguous).toBe(true);
    expect(identity.ambiguityReason).toContain("sender registered as 'Huawei'");
    expect(identity.ambiguityReason).toContain("belongs to 'ZTE' (PEN 3902)");
    expect(identity.vendor).toBe('Standard');
  });

  it('extracts sysObjectID from varbinds and detects conflict with enterprise trap OID', () => {
    const notification = {
      trapOid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.1', // Huawei
      varbinds: [
        {
          oid: '1.3.6.1.2.1.1.2.0',
          type: 'ObjectIdentifier',
          value: '1.3.6.1.4.1.3902.1', // ZTE sysObjectID
        },
      ],
    };

    const unassignedContext: SnmpSenderContext = {
      tenantId: 'tenant-test',
      connectionId: 'conn-2',
      oltId: 'olt-unknown',
    };

    const identity = resolveDeviceIdentity(notification, unassignedContext);
    expect(identity.isAmbiguous).toBe(true);
    expect(identity.ambiguityReason).toContain('Conflicting vendor evidence');
  });
});
