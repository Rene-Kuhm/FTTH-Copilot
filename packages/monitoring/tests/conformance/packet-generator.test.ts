import { describe, expect, it } from 'vitest';
import {
  fixtureTrapToSendOptions,
  generateSyntheticMalformedBytes,
  type FixtureTrapItem,
} from '../../src';

/** sysUpTime.0 — re-added by the SNMP layer, never a fixture varbind. */
const SYS_UP_TIME_OID = '1.3.6.1.2.1.1.3.0';
/** snmpTrapOID.0 — re-added by the SNMP layer, never a fixture varbind. */
const SNMP_TRAP_OID = '1.3.6.1.6.3.1.1.4.1.0';

const DEVICE_VARBIND_OID = '1.3.6.1.4.1.2011.6.128.1.1.2.43.1.1';
const TRAP_OID = '1.3.6.1.4.1.2011.6.128.1.1.2.43.2.0.2.1.14';

function makeFixture(overrides: Partial<FixtureTrapItem> = {}): FixtureTrapItem {
  return {
    description: 'Huawei MA5600 GPON ONT Dying Gasp alarm',
    version: 'v2c',
    trapOid: TRAP_OID,
    senderIp: '10.100.1.10',
    senderPort: 162,
    varbinds: [
      { oid: SYS_UP_TIME_OID, type: 'TimeTicks', value: 345600 },
      { oid: SNMP_TRAP_OID, type: 'OID', value: TRAP_OID },
      {
        oid: DEVICE_VARBIND_OID,
        type: 'OctetString',
        value: 'HWTC12345678',
        rawHex: '485754433132333435363738',
      },
    ],
    ...overrides,
  };
}

/**
 * Minimal BER/DER header reader used to assert the *shape* of the synthetic
 * malformed payloads (tag + declared length) instead of comparing them against
 * a byte copy of the implementation output.
 */
function readAsn1Header(buf: Buffer, offset = 0): { tag: number; length: number; headerBytes: number } {
  const tag = buf[offset];
  if (tag === undefined) throw new Error(`missing ASN.1 tag at offset ${offset}`);
  const firstLengthByte = buf[offset + 1];
  if (firstLengthByte === undefined) throw new Error(`missing ASN.1 length at offset ${offset}`);

  if ((firstLengthByte & 0x80) === 0) {
    return { tag, length: firstLengthByte, headerBytes: 2 };
  }

  const lengthByteCount = firstLengthByte & 0x7f;
  if (lengthByteCount === 0) throw new Error('indefinite length is not valid DER');

  let length = 0;
  for (let i = 0; i < lengthByteCount; i++) {
    const byte = buf[offset + 2 + i];
    if (byte === undefined) throw new Error('truncated ASN.1 length field');
    length = length * 256 + byte;
  }
  return { tag, length, headerBytes: 2 + lengthByteCount };
}

describe('Conformance Lab: SNMP Packet Generator (Roadmap Fase 7)', () => {
  describe('fixtureTrapToSendOptions', () => {
    it.each([
      ['v1', 'v1'],
      ['v2c', 'v2c'],
      ['v3', 'v3'],
    ] as const)('maps fixture version %s to SNMP version %s', (fixtureVersion, expected) => {
      const options = fixtureTrapToSendOptions(makeFixture({ version: fixtureVersion }), 1162);
      expect(options.version).toBe(expected);
    });

    it.each([undefined, 'v2', 'V3', 'snmp-v1', ''])(
      'falls back to the default v2c for a missing or unrecognized version (%s)',
      (fixtureVersion) => {
        const options = fixtureTrapToSendOptions(makeFixture({ version: fixtureVersion }), 1620);
        expect(options.version).toBe('v2c');
      },
    );

    it('targets the caller-supplied port, ignoring the recorded sender port', () => {
      const fixture = makeFixture({ senderPort: 162, senderIp: '10.100.1.10' });
      const options = fixtureTrapToSendOptions(fixture, 12191);

      expect(options.port).toBe(12191);
      expect(options.port).not.toBe(fixture.senderPort);
    });

    it('defaults host to loopback and honours an explicit host override', () => {
      const fixture = makeFixture({ senderIp: '10.100.1.10' });

      expect(fixtureTrapToSendOptions(fixture, 1620).host).toBe('127.0.0.1');
      expect(fixtureTrapToSendOptions(fixture, 1620, '10.0.0.5').host).toBe('10.0.0.5');
    });

    it('carries the trap OID through unchanged', () => {
      const options = fixtureTrapToSendOptions(makeFixture({ trapOid: TRAP_OID }), 1620);
      expect(options.trapOid).toBe(TRAP_OID);
    });

    it('returns only the executable send options, without inventing credentials or PDU fields', () => {
      const options = fixtureTrapToSendOptions(makeFixture(), 1620);
      expect(Object.keys(options).sort()).toEqual(['host', 'port', 'trapOid', 'varbinds', 'version']);
      expect(options).not.toHaveProperty('community');
      expect(options).not.toHaveProperty('v3User');
      expect(options).not.toHaveProperty('pduType');
    });

    it('maps varbinds to oid/type/value tuples in fixture order and drops rawHex', () => {
      const options = fixtureTrapToSendOptions(makeFixture(), 1620);

      expect(options.varbinds).toHaveLength(1);
      expect(options.varbinds?.[0]).toEqual({
        oid: DEVICE_VARBIND_OID,
        type: 'OctetString',
        value: 'HWTC12345678',
      });
      expect(options.varbinds?.[0]).not.toHaveProperty('rawHex');
    });

    it('keeps the numeric type of a varbind and leaves an omitted type undefined', () => {
      const options = fixtureTrapToSendOptions(
        makeFixture({
          varbinds: [
            { oid: DEVICE_VARBIND_OID, type: 2, value: 99 },
            { oid: `${DEVICE_VARBIND_OID}.1`, value: 'no-type' },
          ],
        }),
        1620,
      );

      expect(options.varbinds?.[0]).toEqual({ oid: DEVICE_VARBIND_OID, type: 2, value: 99 });
      expect(options.varbinds?.[1]?.oid).toBe(`${DEVICE_VARBIND_OID}.1`);
      expect(options.varbinds?.[1]?.type).toBeUndefined();
    });

    it('passes non-primitive varbind values through without serializing them', () => {
      const binaryValue = Buffer.from('HWTC12345678', 'utf8');
      const options = fixtureTrapToSendOptions(
        makeFixture({ varbinds: [{ oid: DEVICE_VARBIND_OID, type: 'OctetString', value: binaryValue }] }),
        1620,
      );

      expect(options.varbinds?.[0]?.value).toBe(binaryValue);
    });

    it('drops the sysUpTime and snmpTrapOID header varbinds but keeps look-alike OIDs', () => {
      const similarOid = `${SNMP_TRAP_OID}.1`;
      const options = fixtureTrapToSendOptions(
        makeFixture({
          varbinds: [
            { oid: SYS_UP_TIME_OID, type: 'TimeTicks', value: 345600 },
            { oid: SNMP_TRAP_OID, type: 'OID', value: TRAP_OID },
            { oid: similarOid, type: 'OID', value: `${TRAP_OID}.1` },
            { oid: DEVICE_VARBIND_OID, type: 'OctetString', value: 'HWTC12345678' },
          ],
        }),
        1620,
      );

      const returnedOids = (options.varbinds ?? []).map((vb) => vb.oid);
      expect(returnedOids).not.toContain(SYS_UP_TIME_OID);
      expect(returnedOids).not.toContain(SNMP_TRAP_OID);
      expect(returnedOids).toEqual([similarOid, DEVICE_VARBIND_OID]);
    });

    it('tolerates a fixture with an empty or missing varbind list', () => {
      expect(fixtureTrapToSendOptions(makeFixture({ varbinds: [] }), 1620).varbinds).toEqual([]);

      const fixtureWithoutVarbinds = {
        description: 'legacy fixture without varbinds',
        trapOid: TRAP_OID,
      } as unknown as FixtureTrapItem;
      expect(fixtureTrapToSendOptions(fixtureWithoutVarbinds, 1620).varbinds).toEqual([]);
    });

    it('does not mutate the source fixture', () => {
      const fixture = makeFixture();
      const snapshot = structuredClone(fixture);

      const options = fixtureTrapToSendOptions(fixture, 1620);

      expect(fixture).toEqual(snapshot);
      expect(fixture.varbinds).toHaveLength(3);
      expect(fixture.varbinds[2]?.rawHex).toBe('485754433132333435363738');
      expect(options.varbinds).not.toBe(fixture.varbinds);
    });
  });

  describe('generateSyntheticMalformedBytes', () => {
    const anomalies = [
      'truncated_sequence',
      'oversized_length',
      'invalid_tag',
      'deep_recursion',
      'zero_length',
    ] as const;

    it('returns a Buffer for every named anomaly and is deterministic', () => {
      for (const anomaly of anomalies) {
        const first = generateSyntheticMalformedBytes(anomaly);
        const second = generateSyntheticMalformedBytes(anomaly);

        expect(Buffer.isBuffer(first)).toBe(true);
        expect(first.equals(second)).toBe(true);
      }
    });

    it('truncated_sequence declares more payload bytes than it carries', () => {
      const buf = generateSyntheticMalformedBytes('truncated_sequence');
      const { tag, length, headerBytes } = readAsn1Header(buf);

      expect(tag).toBe(0x30); // SEQUENCE
      expect(length).toBeGreaterThan(buf.length - headerBytes);
      expect(buf.length - headerBytes).toBeGreaterThan(0);
    });

    it('oversized_length uses a multi-byte length that exceeds the payload', () => {
      const buf = generateSyntheticMalformedBytes('oversized_length');
      const { tag, length, headerBytes } = readAsn1Header(buf);

      expect(tag).toBe(0x30); // SEQUENCE
      expect(headerBytes).toBeGreaterThan(2); // long-form length encoding
      expect(length).toBeGreaterThan(buf.length - headerBytes);
    });

    it('invalid_tag starts with a private-class long-form tag SNMP cannot interpret', () => {
      const buf = generateSyntheticMalformedBytes('invalid_tag');
      const firstByte = buf[0] as number;

      expect(buf.length).toBeGreaterThan(1);
      expect(firstByte >> 6).toBe(0b11); // private class
      expect(firstByte & 0x1f).toBe(0x1f); // long-form tag number marker
      expect(firstByte).not.toBe(0x30);
    });

    it('deep_recursion nests well-formed SEQUENCEs past any sane nesting limit', () => {
      const buf = generateSyntheticMalformedBytes('deep_recursion');

      let offset = 0;
      let depth = 0;
      let lastDeclaredLength = Number.NaN;

      while (offset < buf.length) {
        const { tag, length, headerBytes } = readAsn1Header(buf, offset);
        expect(tag).toBe(0x30); // SEQUENCE
        // Each sequence claims the whole remainder as its payload, so the next
        // nested sequence starts right after this header.
        expect(length).toBe(buf.length - offset - headerBytes);
        lastDeclaredLength = length;
        offset += headerBytes;
        depth++;
      }

      expect(depth).toBe(50);
      expect(lastDeclaredLength).toBe(0);
      expect(offset).toBe(buf.length);
    });

    it('zero_length returns an empty buffer', () => {
      expect(generateSyntheticMalformedBytes('zero_length')).toHaveLength(0);
    });

    it('returns a single EOC byte for an unrecognized anomaly', () => {
      const unknownAnomaly = 'not_a_real_anomaly' as unknown as Parameters<
        typeof generateSyntheticMalformedBytes
      >[0];
      const buf = generateSyntheticMalformedBytes(unknownAnomaly);

      expect(buf).toHaveLength(1);
      expect(buf[0]).toBe(0x00);
    });
  });
});
