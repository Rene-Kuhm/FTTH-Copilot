import { describe, expect, it } from 'vitest';
import { createRawEvidenceEnvelope } from '../../src/snmp/evidence';
import type { DecodedSnmpNotification } from '../../src/snmp/types';

describe('Raw SNMP Evidence Envelope (Roadmap Fase 0)', () => {
  it('creates immutable evidence envelope with redacted credentials and canonical fingerprint', () => {
    const notification: DecodedSnmpNotification = {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '192.168.1.50',
      senderPort: 1162,
      trapOid: '1.3.6.1.6.3.1.1.5.3',
      sysUpTime: 123456,
      eventTime: '2026-09-10T14:30:00Z',
      receivedAtMs: 1700000000000,
      varbinds: [
        {
          oid: '1.3.6.1.2.1.2.2.1.1.1',
          type: 'Integer',
          value: 1,
        },
        {
          oid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.1',
          type: 'OctetString',
          value: 'HWTC87654321',
        },
      ],
      requestId: 55,
    };

    const envelope = createRawEvidenceEnvelope(notification);

    expect(envelope.evidenceId).toBeDefined();
    expect(envelope.credentialsRedacted).toBe(true);
    expect(envelope.senderIp).toBe('192.168.1.50');
    expect(envelope.senderPort).toBe(1162);
    expect(envelope.snmpVersion).toBe('v2c');
    expect(envelope.pduType).toBe('TrapV2');
    expect(envelope.trapOid).toBe('1.3.6.1.6.3.1.1.5.3');
    expect(envelope.sysUpTime).toBe(123456);
    expect(envelope.eventTime).toBe('2026-09-10T14:30:00Z');
    expect(envelope.fingerprint).toHaveLength(64); // SHA-256 hex
    expect(envelope.varbinds).toHaveLength(2);

    // Verify credentials cannot leak
    expect((envelope as unknown as Record<string, unknown>)['community']).toBeUndefined();
    expect((envelope as unknown as Record<string, unknown>)['authKey']).toBeUndefined();
    expect((envelope as unknown as Record<string, unknown>)['privKey']).toBeUndefined();
  });
});
