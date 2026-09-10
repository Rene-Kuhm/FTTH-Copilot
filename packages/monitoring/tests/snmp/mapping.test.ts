import { describe, expect, it } from 'vitest';
import {
  createSenderRegistry,
  resolveTrapSender,
  type SnmpSenderRegistration,
} from '../../src/snmp/mapping';

describe('SNMP Sender Registry & Tenant Isolation (Roadmap Fase 6 — 6.2)', () => {
  const registrations: SnmpSenderRegistration[] = [
    {
      senderIp: '10.100.1.10',
      tenantId: 'tenant-alfa',
      connectionId: 'conn-alfa-olt1',
      oltId: 'OLT-NORTE',
      vendor: 'Huawei',
    },
    {
      senderIp: '10.200.2.20',
      tenantId: 'tenant-beta',
      connectionId: 'conn-beta-olt1',
      oltId: 'OLT-SUR',
      vendor: 'ZTE',
    },
  ];

  const registry = createSenderRegistry(registrations);

  it('resolves registered sender IP to the correct tenant, connection, and OLT', () => {
    const sender = resolveTrapSender('10.100.1.10', registry);
    expect(sender).not.toBeNull();
    expect(sender?.tenantId).toBe('tenant-alfa');
    expect(sender?.connectionId).toBe('conn-alfa-olt1');
    expect(sender?.oltId).toBe('OLT-NORTE');
    expect(sender?.vendor).toBe('Huawei');
  });

  it('rejects unregistered sender IP and returns null (6.2 unauthorized drop)', () => {
    const sender = resolveTrapSender('192.168.1.99', registry);
    expect(sender).toBeNull();
  });

  it('strictly ignores any tenantId claimed in payload to prevent spoofing (6.2)', () => {
    const spoofedClaim = 'tenant-spoofed-attacker';
    const sender = resolveTrapSender('10.100.1.10', registry, spoofedClaim);
    expect(sender).not.toBeNull();
    // Identity must come strictly from the registry, never the payload
    expect(sender?.tenantId).toBe('tenant-alfa');
    expect(sender?.tenantId).not.toBe(spoofedClaim);
  });
});
