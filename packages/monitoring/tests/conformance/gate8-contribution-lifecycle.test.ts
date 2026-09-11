import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import {
  sanitizeSnmpCapture,
  createManagedSnmpReceiver,
  sendSnmpTestTrap,
  setSimulatorProvisionalTraps,
  type SnmpSenderRegistration,
  type TelemetryEvent,
  type RawSnmpEvidenceEnvelope,
} from '../../src';

describe('Gate 8: External Contribution Lifecycle (Sanitized Capture to L2)', () => {
  beforeAll(() => {
    setSimulatorProvisionalTraps(true);
  });

  afterAll(() => {
    setSimulatorProvisionalTraps(false);
  });
  it('processes raw external capture through sanitization and normalizes to L2 telemetry without secrets', async () => {
    // 1. Raw contributed JSON capture with operator secrets
    const rawContributedCapture = JSON.stringify({
      schema: 'snmp.trap.raw.v1',
      senderIp: '10.240.12.88',
      community: 'oper_super_secret_comm_2026',
      metadata: {
        host: 'olt-primary-node.pop01.isp.net',
        subscriberNote: 'pppoe-user: "subscriber_9918@metro.isp.net", circuit-id: "GPON-01-VLAN-100"',
      },
      pdu: {
        trapOid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.2.0.2.1.14', // Huawei ONT Dying Gasp
        sysUpTime: 987654,
        varbinds: [
          {
            oid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.1.9.0.2.14',
            type: 'OctetString',
            value: 'HWTC98765432', // Raw customer ONT serial
          },
          {
            oid: '1.3.6.1.2.1.1.5.0',
            type: 'OctetString',
            value: 'olt-primary-node.pop01.isp.net',
          },
        ],
      },
    });

    // 2. Sanitize the capture using the built-in sanitizer
    const sanitizedJsonStr = sanitizeSnmpCapture(rawContributedCapture, {
      customCommunities: ['oper_super_secret_comm_2026'],
      ipReplacementMode: 'doc-ip',
    });

    // Verify ZERO secrets leaked in sanitized payload
    expect(sanitizedJsonStr).not.toContain('oper_super_secret_comm_2026');
    expect(sanitizedJsonStr).not.toContain('10.240.12.88');
    expect(sanitizedJsonStr).not.toContain('olt-primary-node.pop01.isp.net');
    expect(sanitizedJsonStr).not.toContain('subscriber_9918@metro.isp.net');
    expect(sanitizedJsonStr).not.toContain('HWTC98765432');

    // Verify deterministic redactions & vendor prefix preservation
    expect(sanitizedJsonStr).toContain('<REDACTED_COMMUNITY>');
    expect(sanitizedJsonStr).toContain('192.0.2.1');
    expect(sanitizedJsonStr).toContain('olt-sanitized.isp.example');
    expect(sanitizedJsonStr).toContain('<REDACTED_CUSTOMER_ID>');
    expect(sanitizedJsonStr).toContain('HWTC********');

    // 3. Register sender in managed receiver using simulated loopback
    const TEST_PORT = 12199;
    const testRegistrations: SnmpSenderRegistration[] = [
      {
        senderIp: '127.0.0.1',
        tenantId: 'tenant-contrib-demo',
        deviceId: 'huawei-ma5600-sanitized',
        deviceKind: 'OLT',
        vendor: 'Huawei',
        community: 'sanitized-comm',
      },
    ];

    let receivedTelemetry: TelemetryEvent | undefined;
    let receivedEvidence: RawSnmpEvidenceEnvelope | undefined;

    const receiver = createManagedSnmpReceiver({
      port: TEST_PORT,
      address: '127.0.0.1',
      registrations: testRegistrations,
      onTelemetryEvent: (event, evidence) => {
        receivedTelemetry = event;
        receivedEvidence = evidence;
      },
    });

    try {
      // 4. Send trap with sanitized data over UDP loopback
      await sendSnmpTestTrap({
        port: TEST_PORT,
        version: 'v2c',
        community: 'sanitized-comm',
        trapOid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.2.0.2.1.14',
        varbinds: [
          {
            oid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.1.9.0.2.14',
            type: 'OctetString',
            value: 'HWTC********',
          },
        ],
      });

      // Await event processing
      let attempts = 0;
      while (!receivedTelemetry && attempts < 40) {
        await new Promise((r) => setTimeout(r, 25));
        attempts++;
      }

      // 5. Assert Gate 8 compliance: Level L2 normalization without secrets
      expect(receivedTelemetry).toBeDefined();
      expect(receivedTelemetry?.tenantId).toBe('tenant-contrib-demo');
      expect(receivedTelemetry?.deviceKind).toBe('ONU');
      expect(receivedTelemetry?.deviceId).toBe('HWTC********');
      expect(receivedTelemetry?.metrics['trapCategory']).toBe('dying_gasp');

      expect(receivedEvidence).toBeDefined();
      expect(receivedEvidence?.trapOid).toBe('1.3.6.1.4.1.2011.6.128.1.1.2.43.2.0.2.1.14');
      expect(receivedEvidence?.fingerprint).toBeDefined();
    } finally {
      await new Promise<void>((resolve) => receiver.close(() => resolve()));
    }
  });
});
