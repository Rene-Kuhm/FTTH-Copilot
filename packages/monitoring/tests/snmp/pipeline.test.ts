import { describe, expect, it } from 'vitest';
import { telemetryEventSchema } from '@ftth-copilot/shared';
import { processSnmpNotification } from '../../src/snmp/pipeline';
import { createManagedSnmpReceiver } from '../../src/snmp/receiver';
import { sendSnmpTestTrap } from '../../src/snmp/test-client';
import type { SnmpSenderContext, SnmpSenderRegistration } from '../../src/snmp/mapping';
import type { DecodedSnmpNotification, RawSnmpEvidenceEnvelope } from '../../src/snmp/types';

describe('SNMP Normalization Pipeline (Roadmap Fase 2 — Gate 2)', () => {
  const baseContext: SnmpSenderContext = {
    tenantId: 'tenant-acme',
    connectionId: 'conn-gpon-1',
    oltId: 'olt-pop-central',
    vendor: 'Standard',
  };

  const mockEvidence: RawSnmpEvidenceEnvelope = {
    evidenceId: 'ev-test-1',
    receivedAt: '2026-09-10T14:00:00.000Z',
    senderIp: '127.0.0.1',
    senderPort: 12180,
    snmpVersion: 'v2c',
    pduType: 'TrapV2',
    trapOid: '1.3.6.1.6.3.1.1.5.3',
    sysUpTime: 99999,
    eventTime: null,
    varbinds: [],
    credentialsRedacted: true,
    fingerprint: 'sha256-pipeline-evidence-fingerprint',
  };

  it('normalizes linkDown trap into valid ftth.telemetry.v1 schema event', () => {
    const notification: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '127.0.0.1',
      senderPort: 12180,
      trapOid: '1.3.6.1.6.3.1.1.5.3',
      sysUpTime: 99999,
      receivedAtMs: Date.now(),
      varbinds: [
        { oid: '1.3.6.1.2.1.2.2.1.1.10', type: 'Integer', value: 10 },
        { oid: '1.3.6.1.2.1.2.2.1.7.10', type: 'Integer', value: 1 }, // up
        { oid: '1.3.6.1.2.1.2.2.1.8.10', type: 'Integer', value: 2 }, // down
        { oid: '1.3.6.1.2.1.31.1.1.1.1.10', type: 'OctetString', value: 'xe-0/1/10' },
      ],
    };

    const { event, identity } = processSnmpNotification(notification, baseContext, mockEvidence);

    // Validate against shared schema
    const parsed = telemetryEventSchema.parse(event);
    expect(parsed.schema).toBe('ftth.telemetry.v1');
    expect(parsed.tenantId).toBe('tenant-acme');
    expect(parsed.deviceId).toBe('olt-pop-central');
    expect(parsed.deviceKind).toBe('OLT');
    expect(parsed.source).toBe('snmp-trap');
    expect(parsed.metrics.trapName).toBe('linkDown');
    expect(parsed.metrics.ifIndex).toBe(10);
    expect(parsed.metrics.ifOperStatus).toBe('down');
    expect(parsed.tags?.['interface']).toBe('xe-0/1/10');
    expect(identity.isAmbiguous).toBe(false);
  });

  it('normalizes authenticationFailure into valid ftth.telemetry.v1 schema event', () => {
    const notification: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '127.0.0.1',
      senderPort: 12180,
      trapOid: '1.3.6.1.6.3.1.1.5.5',
      receivedAtMs: Date.now(),
      varbinds: [],
    };

    const { event } = processSnmpNotification(notification, baseContext, mockEvidence);
    const parsed = telemetryEventSchema.parse(event);
    expect(parsed.schema).toBe('ftth.telemetry.v1');
    expect(parsed.metrics.trapName).toBe('authenticationFailure');
    expect(parsed.metrics.trapCategory).toBe('auth_failure');
    expect(parsed.metrics.severity).toBe('warning');
  });

  it('routes binary datagrams end-to-end to onTelemetryEvent via ManagedSnmpReceiver', async () => {
    const testPort = 12185;
    const registrations: SnmpSenderRegistration[] = [
      {
        senderIp: '127.0.0.1',
        tenantId: 'tenant-e2e',
        connectionId: 'conn-e2e',
        oltId: 'olt-e2e-01',
        community: 'public',
        version: 'v2c',
      },
    ];

    let receivedTelemetryEvent: unknown = null;

    const receiver = createManagedSnmpReceiver({
      port: testPort,
      address: '127.0.0.1',
      registrations,
      onTelemetryEvent: (event) => {
        receivedTelemetryEvent = event;
      },
    });

    try {
      // Send binary SNMPv2c linkDown trap with IF-MIB varbinds
      await sendSnmpTestTrap({
        port: testPort,
        host: '127.0.0.1',
        version: 'v2c',
        community: 'public',
        trapOid: '1.3.6.1.6.3.1.1.5.3',
        varbinds: [
          {
            oid: '1.3.6.1.2.1.2.2.1.1.3',
            type: 2, // Integer
            value: 3,
          },
          {
            oid: '1.3.6.1.2.1.2.2.1.8.3',
            type: 2, // Integer
            value: 2, // down
          },
        ],
      });

      // Wait briefly for asynchronous UDP loopback processing
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(receivedTelemetryEvent).not.toBeNull();
      const event = telemetryEventSchema.parse(receivedTelemetryEvent);
      expect(event.schema).toBe('ftth.telemetry.v1');
      expect(event.tenantId).toBe('tenant-e2e');
      expect(event.deviceId).toBe('olt-e2e-01');
      expect(event.metrics.trapName).toBe('linkDown');
      expect(event.metrics.ifIndex).toBe(3);
      expect(event.metrics.ifOperStatus).toBe('down');
    } finally {
      await new Promise<void>((resolve) => receiver.close(resolve));
    }
  });
});
