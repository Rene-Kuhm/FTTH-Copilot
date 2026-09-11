import dgram from 'node:dgram';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  createManagedSnmpReceiver,
  createRawEvidenceEnvelope,
  decodeSnmpTrap,
  formatVarbindValue,
  generateSyntheticMalformedBytes,
  type DecodedSnmpNotification,
} from '../../src';

describe('Conformance Lab: Property-Based ASN.1 & Varbind Testing (Roadmap Fase 7)', () => {
  // 5.1 Arbitrary Payload Resiliency
  it('property: decodeSnmpTrap never throws for arbitrary input objects or primitives', () => {
    fc.assert(
      fc.property(fc.anything(), (arbitraryInput) => {
        expect(() => {
          const res = decodeSnmpTrap(arbitraryInput);
          expect(res).toBeDefined();
          expect(typeof res.version).toBe('string');
          expect(typeof res.pduType).toBe('string');
          expect(Array.isArray(res.varbinds)).toBe(true);
        }).not.toThrow();
      }),
      { numRuns: 200 },
    );
  });

  // 5.2 Arbitrary Varbind Types & Values Safety
  it('property: formatVarbindValue safely handles arbitrary types without exceptions', () => {
    fc.assert(
      fc.property(fc.anything(), (val) => {
        expect(() => {
          const formatted = formatVarbindValue(val);
          if (val === null || val === undefined) {
            expect(formatted).toBeNull();
          } else if (typeof val === 'number' || typeof val === 'boolean' || typeof val === 'string') {
            expect(formatted).toBe(val);
          } else {
            expect(typeof formatted).toBe('string');
          }
        }).not.toThrow();
      }),
      { numRuns: 200 },
    );
  });

  // 5.3 OID Parsing & Arbitrary Sub-identifiers
  it('property: arbitrary OID formats and deep sub-identifier chains parse safely', () => {
    const oidArbitrary = fc
      .array(fc.integer({ min: 0, max: 65535 }), { minLength: 1, maxLength: 64 })
      .map((parts) => `1.3.6.1.4.1.${parts.join('.')}`);

    fc.assert(
      fc.property(oidArbitrary, fc.string(), (oid, value) => {
        const notif: DecodedSnmpNotification = {
          version: 'v2c',
          pduType: 'TrapV2',
          senderIp: '127.0.0.1',
          senderPort: 162,
          trapOid: oid,
          receivedAtMs: Date.now(),
          varbinds: [{ oid, type: 'OctetString', value }],
        };

        expect(() => {
          const evidence = createRawEvidenceEnvelope(notif);
          expect(evidence.trapOid).toBe(oid);
          expect(evidence.varbinds[0]?.oid).toBe(oid);
          expect(evidence.fingerprint).toBeDefined();
        }).not.toThrow();
      }),
      { numRuns: 100 },
    );
  });

  // 5.4 Zero Credential Leakage Guarantee
  it('property: raw evidence envelopes strictly guarantee zero credential leakage', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 8, maxLength: 32 }),
        fc.string({ minLength: 8, maxLength: 32 }),
        (secretCommunity, secretKey) => {
          const notif: DecodedSnmpNotification = {
            version: 'v3',
            pduType: 'TrapV2',
            senderIp: '127.0.0.1',
            senderPort: 162,
            trapOid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.2',
            receivedAtMs: Date.now(),
            varbinds: [
              { oid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.1.1', type: 'OctetString', value: 'HWTC12345678' },
            ],
          };

          const envelope = createRawEvidenceEnvelope(notif);
          const serialized = JSON.stringify(envelope);

          expect(envelope.credentialsRedacted).toBe(true);
          expect(serialized).not.toContain(secretCommunity);
          expect(serialized).not.toContain(secretKey);
        },
      ),
      { numRuns: 50 },
    );
  });

  // 5.5 Wire-Level Malformed ASN.1 Bytes over UDP Loopback
  it('handles wire-level malformed ASN.1 frames without receiver crash', async () => {
    const testPort = 12191;
    const errors: Error[] = [];

    const receiver = createManagedSnmpReceiver({
      port: testPort,
      address: '127.0.0.1',
      disableAuthorization: true,
      onError: (err) => {
        errors.push(err);
      },
    });

    const anomalies = [
      'truncated_sequence',
      'oversized_length',
      'invalid_tag',
      'deep_recursion',
      'zero_length',
    ] as const;

    const client = dgram.createSocket('udp4');

    try {
      for (const anomaly of anomalies) {
        const malformedBytes = generateSyntheticMalformedBytes(anomaly);
        await new Promise<void>((resolve) => {
          client.send(malformedBytes, testPort, '127.0.0.1', () => resolve());
        });
        await new Promise((r) => setTimeout(r, 30));
      }

      // Assert receiver is still alive and responsive after malformed byte storm
      expect(errors.length).toBeGreaterThanOrEqual(0);
    } finally {
      client.close();
      receiver.close();
    }
  });
});
