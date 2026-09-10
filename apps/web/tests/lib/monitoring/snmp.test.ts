import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startSnmpReceiver } from '@/lib/monitoring/snmp';
import {
  snapshotHealth,
  __resetSchedulerHealth,
} from '@/lib/monitoring/scheduler-health';
import { sendSnmpTestTrap, type RawSnmpEvidenceEnvelope } from '@ftth-copilot/monitoring';

describe('SNMP Receiver Service (Roadmap Fase 6 & Roadmap Fase 0)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    __resetSchedulerHealth();
    process.env = { ...originalEnv };
    delete process.env['SNMP_RECEIVER_ENABLED'];
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('is disabled by default and does not bind a socket (Rule 10)', () => {
    const stop = startSnmpReceiver();
    const health = snapshotHealth();
    expect(health['snmp']?.expected).toBe(false);
    expect(health['snmp']?.bound).toBe(false);
    stop();
  });

  it('marks service as expected when SNMP_RECEIVER_ENABLED is true and receives real binary traps', async () => {
    process.env['SNMP_RECEIVER_ENABLED'] = 'true';
    process.env['SNMP_UDP_PORT'] = '12199';

    const receivedEvents: any[] = [];
    const receivedEvidences: RawSnmpEvidenceEnvelope[] = [];

    const stop = startSnmpReceiver({
      registrations: [
        {
          senderIp: '127.0.0.1',
          tenantId: 'tenant-web',
          connectionId: 'conn-web-1',
          oltId: 'OLT-WEB-01',
          vendor: 'Huawei',
          community: 'public',
        },
      ],
      onEvent: (event) => {
        receivedEvents.push(event);
      },
      onEvidence: (evidence) => {
        receivedEvidences.push(evidence);
      },
    });

    const health = snapshotHealth();
    expect(health['snmp']?.expected).toBe(true);
    expect(health['snmp']?.bound).toBe(true);

    try {
      await sendSnmpTestTrap({
        port: 12199,
        version: 'v2c',
        trapOid: '1.3.6.1.6.3.1.1.5.3', // linkDown
        varbinds: [
          {
            oid: '1.3.6.1.2.1.2.2.1.1.1',
            value: 42,
          },
        ],
      });

      await new Promise((r) => setTimeout(r, 200));

      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0].metrics.snmpTrapOid).toBe('1.3.6.1.6.3.1.1.5.3');
      expect(receivedEvents[0].deviceId).toBe('OLT-WEB-01');

      expect(receivedEvidences).toHaveLength(1);
      expect(receivedEvidences[0].credentialsRedacted).toBe(true);
      expect(receivedEvidences[0].fingerprint).toBeDefined();
    } finally {
      stop();
    }

    const healthAfter = snapshotHealth();
    expect(healthAfter['snmp']?.bound).toBe(false);
  });
});
