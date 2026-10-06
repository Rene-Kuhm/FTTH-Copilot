import { describe, expect, it } from 'vitest';
import { OltAdapterRegistry } from '../../src/snmp/adapter/registry';
import type { OltVendorAdapter } from '../../src/snmp/adapter/contract';
import type { ResolvedDeviceIdentity } from '../../src/snmp/identity';
import type { DecodedSnmpNotification } from '../../src/snmp/types';

/**
 * The registry decides which vendor parser runs for a trap. Resolving the
 * wrong adapter means interpreting one vendor's OID set with another's rules,
 * so the ambiguity guard matters more than the lookup itself.
 */
function stubAdapter(vendorId: string, supports: (n: DecodedSnmpNotification) => boolean): OltVendorAdapter {
  return {
    vendorId,
    supportedPens: [],
    // Call the supplied predicate: returning it would yield a function, which is
    // truthy, and every adapter would match.
    supports: () => supports(),
    parse: () => {
      throw new Error('not used');
    },
  } as unknown as OltVendorAdapter;
}

const notification = {
  version: 'v2c',
  pduType: 'TrapV2',
  senderIp: '10.0.0.1',
  senderPort: 162,
  trapOid: '1.3.6.1.4.1.99999.1.1',
  receivedAtMs: 1773316800000,
  varbinds: [],
} as DecodedSnmpNotification;

const identity: ResolvedDeviceIdentity = {
  tenantId: 'tenant-a',
  connectionId: 'conn-1',
  oltId: 'olt-1',
  vendor: 'Stubco',
  pen: 99999,
  isStandardTrap: false,
  isAmbiguous: false,
};

describe('OltAdapterRegistry', () => {
  it('registers the standard adapter on construction', () => {
    const registry = new OltAdapterRegistry();
    expect(registry.listVendors().length).toBeGreaterThan(0);
  });

  it('retrieves a registered adapter', () => {
    const registry = new OltAdapterRegistry();
    const adapter = stubAdapter('stubco', () => true);
    registry.register(adapter);

    expect(registry.getAdapter('stubco')).toBe(adapter);
  });

  it('resolves the vendor id case-insensitively', () => {
    const registry = new OltAdapterRegistry();
    const adapter = stubAdapter('stubco', () => true);
    registry.register(adapter);

    expect(registry.getAdapter('STUBCO')).toBe(adapter);
    expect(registry.getAdapter('StubCo')).toBe(adapter);
  });

  it('returns undefined for a vendor it does not know', () => {
    const registry = new OltAdapterRegistry();
    expect(registry.getAdapter('never-registered')).toBeUndefined();
  });

  it('lists every registered vendor exactly once', () => {
    const registry = new OltAdapterRegistry();
    registry.register(stubAdapter('stubco', () => true));

    const vendors = registry.listVendors();
    expect(vendors).toContain('stubco');
    expect(new Set(vendors).size).toBe(vendors.length);
  });

  it('overwrites a re-registered vendor rather than duplicating it', () => {
    const registry = new OltAdapterRegistry();
    const first = stubAdapter('stubco', () => true);
    const second = stubAdapter('stubco', () => false);

    registry.register(first);
    registry.register(second);

    expect(registry.getAdapter('stubco')).toBe(second);
    expect(registry.listVendors().filter((v) => v === 'stubco')).toHaveLength(1);
  });

  it('resolves an adapter whose supports() agrees', () => {
    const registry = new OltAdapterRegistry();
    const adapter = stubAdapter('stubco', () => true);
    registry.register(adapter);

    expect(registry.resolve(notification, identity)).toBe(adapter);
  });

  it('never invokes a vendor adapter for an ambiguous identity', () => {
    // The whole point of the guard: a sender whose vendor cannot be trusted
    // must not reach vendor-specific parsing, because those rules would read
    // one vendor's OIDs with another's semantics.
    const registry = new OltAdapterRegistry();
    const adapter = stubAdapter('stubco', () => true);
    registry.register(adapter);

    const resolved = registry.resolve(notification, {
      ...identity,
      isAmbiguous: true,
      ambiguityReason: 'sender mismatch',
    });

    expect(resolved).not.toBe(adapter);
  });

  it('does not resolve an adapter whose supports() declines', () => {
    const registry = new OltAdapterRegistry();
    registry.register(stubAdapter('stubco', () => false));

    expect(registry.resolve(notification, identity)).not.toBe(
      registry.getAdapter('stubco'),
    );
  });

  it('falls back to the standard adapter for unmatched traps', () => {
    const registry = new OltAdapterRegistry();

    expect(registry.resolve(notification, identity)).toBeDefined();
  });
});