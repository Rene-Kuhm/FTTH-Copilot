import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startSnmpReceiver } from '@/lib/monitoring/snmp';
import {
  snapshotHealth,
  __resetSchedulerHealth,
} from '@/lib/monitoring/scheduler-health';

describe('SNMP Receiver Service (Roadmap Fase 6 — 6.5 + 6.7)', () => {
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

  it('marks service as expected when SNMP_RECEIVER_ENABLED is true', () => {
    process.env['SNMP_RECEIVER_ENABLED'] = 'true';
    process.env['SNMP_UDP_PORT'] = '0'; // bind ephemeral port for test safety

    const stop = startSnmpReceiver({
      registrations: [
        {
          senderIp: '127.0.0.1',
          tenantId: 'tenant-test',
          connectionId: 'conn-test',
          oltId: 'OLT-TEST',
        },
      ],
    });

    const health = snapshotHealth();
    expect(health['snmp']?.expected).toBe(true);
    stop();
  });
});
