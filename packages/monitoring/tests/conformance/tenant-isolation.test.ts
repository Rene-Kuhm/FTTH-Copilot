import { describe, expect, it } from 'vitest';
import {
  createManagedSnmpReceiver,
  createSenderRegistry,
  resolveTrapSender,
  sendSnmpTestTrap,
  type DecodedSnmpNotification,
  type SnmpSenderRegistration,
} from '../../src';
import type { TelemetryEvent } from '@ftth-copilot/shared';

describe('Conformance Lab: Multi-Tenant Isolation Behind Shared Relay / NAT (Roadmap Fase 7)', () => {
  const sharedRelayIp = '198.51.100.254';

  const registrations: SnmpSenderRegistration[] = [
    {
      senderIp: sharedRelayIp,
      tenantId: 'tenant-alfa',
      connectionId: 'conn-alfa-central',
      oltId: 'OLT-ALFA-MA5800',
      vendor: 'Huawei',
      community: 'comm-alfa-secret',
      v3User: {
        name: 'operator-alfa',
        level: 'authPriv',
        authProtocol: 'sha',
        authKey: 'AlfaAuthKey123',
        privProtocol: 'aes',
        privKey: 'AlfaPrivKey123',
      },
    },
    {
      senderIp: sharedRelayIp,
      tenantId: 'tenant-beta',
      connectionId: 'conn-beta-norte',
      oltId: 'OLT-BETA-C320',
      vendor: 'ZTE',
      community: 'comm-beta-secret',
      v3User: {
        name: 'operator-beta',
        level: 'authPriv',
        authProtocol: 'sha',
        authKey: 'BetaAuthKey123',
        privProtocol: 'aes',
        privKey: 'BetaPrivKey123',
      },
    },
  ];

  const registry = createSenderRegistry(registrations);

  // 6.1 Unit-Level Relay Disambiguation
  describe('6.1 Unit-level sender resolution behind shared relay IP', () => {
    it('accurately disambiguates Tenant Alfa using community string', () => {
      const resolved = resolveTrapSender(sharedRelayIp, registry, { community: 'comm-alfa-secret' });
      expect(resolved).not.toBeNull();
      expect(resolved?.tenantId).toBe('tenant-alfa');
      expect(resolved?.oltId).toBe('OLT-ALFA-MA5800');
      expect(resolved?.vendor).toBe('Huawei');
    });

    it('accurately disambiguates Tenant Beta using community string', () => {
      const resolved = resolveTrapSender(sharedRelayIp, registry, { community: 'comm-beta-secret' });
      expect(resolved).not.toBeNull();
      expect(resolved?.tenantId).toBe('tenant-beta');
      expect(resolved?.oltId).toBe('OLT-BETA-C320');
      expect(resolved?.vendor).toBe('ZTE');
    });

    it('accurately disambiguates Tenant Alfa using v3 user', () => {
      const resolved = resolveTrapSender(sharedRelayIp, registry, { v3User: 'operator-alfa' });
      expect(resolved).not.toBeNull();
      expect(resolved?.tenantId).toBe('tenant-alfa');
    });

    it('accurately disambiguates Tenant Beta using v3 user', () => {
      const resolved = resolveTrapSender(sharedRelayIp, registry, { v3User: 'operator-beta' });
      expect(resolved).not.toBeNull();
      expect(resolved?.tenantId).toBe('tenant-beta');
    });

    it('rejects unauthenticated or unmapped traffic from shared relay IP to prevent cross-tenant leaks', () => {
      const unmapped = resolveTrapSender(sharedRelayIp, registry, { community: 'rogue-unknown-community' });
      expect(unmapped).toBeNull();
    });

    it('strictly rejects cross-tenant payload claims / spoofing', () => {
      const spoofedClaim = 'tenant-beta'; // Attacker claims to be tenant-beta
      const resolved = resolveTrapSender(sharedRelayIp, registry, { community: 'comm-alfa-secret' });
      expect(resolved?.tenantId).toBe('tenant-alfa');
      expect(resolved?.tenantId).not.toBe(spoofedClaim);
    });
  });

  // 6.2 End-to-End UDP Loopback Multi-Tenant Verification
  describe('6.2 End-to-end multi-tenant isolation over UDP loopback', () => {
    it('isolates incoming traps to respective tenants without cross-talk or leakage', async () => {
      const testPort = 12192;
      const receivedNotifications: DecodedSnmpNotification[] = [];
      const emittedTelemetry: TelemetryEvent[] = [];

      const loopbackRegistrations: SnmpSenderRegistration[] = [
        {
          senderIp: '127.0.0.1',
          tenantId: 'tenant-isp-red',
          connectionId: 'conn-red-1',
          oltId: 'OLT-RED-HW',
          vendor: 'Huawei',
          community: 'secret-red-isp',
        },
        {
          senderIp: '127.0.0.1',
          tenantId: 'tenant-isp-blue',
          connectionId: 'conn-blue-1',
          oltId: 'OLT-BLUE-ZTE',
          vendor: 'ZTE',
          community: 'secret-blue-isp',
        },
      ];

      const receiver = createManagedSnmpReceiver({
        port: testPort,
        address: '127.0.0.1',
        registrations: loopbackRegistrations,
        onNotification: (notif) => {
          receivedNotifications.push(notif);
        },
        onTelemetryEvent: (event) => {
          emittedTelemetry.push(event);
        },
        onError: (err, ip) => {
          console.error('[test:tenant-isolation] Error:', err.message, ip);
        },
      });

      try {
        // 1. Send trap for Tenant RED
        await sendSnmpTestTrap({
          port: testPort,
          version: 'v2c',
          community: 'secret-red-isp',
          trapOid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.2.0.2.1.14', // Huawei Dying Gasp
          varbinds: [
            { oid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.1.1', type: 'OctetString', value: 'HWTC11112222' },
          ],
        });
        await new Promise((r) => setTimeout(r, 100));

        // 2. Send trap for Tenant BLUE
        await sendSnmpTestTrap({
          port: testPort,
          version: 'v2c',
          community: 'secret-blue-isp',
          trapOid: '1.3.6.1.4.1.3902.1082.500.10.2.2.1.1.1.3.2.5', // ZTE LOS
          varbinds: [
            { oid: '1.3.6.1.4.1.3902.1082.500.10.2.2.1.1.1', type: 'OctetString', value: 'ZTEG33334444' },
          ],
        });
        await new Promise((r) => setTimeout(r, 100));

        // 3. Send unmapped trap with rogue community
        await sendSnmpTestTrap({
          port: testPort,
          version: 'v2c',
          community: 'rogue-unauthorized-community',
          trapOid: '1.3.6.1.6.3.1.1.5.3',
          varbinds: [],
        });
        await new Promise((r) => setTimeout(r, 100));

        // Assertions
        expect(receivedNotifications.length).toBe(2);
        expect(emittedTelemetry.length).toBe(2);

        const redEvent = emittedTelemetry.find((e) => e.tenantId === 'tenant-isp-red');
        const blueEvent = emittedTelemetry.find((e) => e.tenantId === 'tenant-isp-blue');

        expect(redEvent).toBeDefined();
        expect(redEvent?.tags?.['oltId']).toBe('OLT-RED-HW');
        expect(redEvent?.deviceId).toBe('HWTC11112222');

        expect(blueEvent).toBeDefined();
        expect(blueEvent?.tags?.['oltId']).toBe('OLT-BLUE-ZTE');
        expect(blueEvent?.deviceId).toBe('ZTEG33334444');

        // Verify zero events for rogue unauthorized community
        const rogueEvent = emittedTelemetry.find((e) => e.tenantId.includes('rogue'));
        expect(rogueEvent).toBeUndefined();
      } finally {
        receiver.close();
      }
    });
  });
});
