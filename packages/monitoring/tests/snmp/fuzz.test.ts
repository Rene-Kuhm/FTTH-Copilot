import fc from 'fast-check';
import { ObjectType, PduType } from 'net-snmp';
import { expect, it } from 'vitest';
import { decodeSnmpTrap } from '../../src/snmp/decoder';
import { createRawEvidenceEnvelope } from '../../src/snmp/evidence';
import { createSnmpIngestionGuard } from '../../src/snmp/guard';
import { extractEnterprisePen } from '../../src/snmp/iana-pen';
import { parseAndNormalizeSnmpTrap } from '../../src/snmp/parser';
import { sanitizeSnmpCapture } from '../../src/snmp/sanitizer';

const replay = { seed: Number(process.env.FUZZ_SEED ?? 250025), path: process.env.FUZZ_PATH };
const enterpriseRoot = '1.3.6.1.4.1';
const sourceIp = '192.0.2.20';
const receivedAtMs = Date.UTC(2026, 0, 1);

it('preserves numeric enterprise arcs, including a leading dot', () => {
  const arc = fc.integer({ min: 0, max: 0xffff_ffff });
  fc.assert(fc.property(
    fc.integer({ min: 1, max: 0xffff_ffff }),
    fc.array(arc, { maxLength: 32 }),
    (pen, tail) => {
      const oid = [enterpriseRoot, pen, ...tail].join('.');
      expect(extractEnterprisePen(oid)).toBe(pen);
      expect(extractEnterprisePen(` .${oid} `)).toBe(pen);
    },
  ), { ...replay, numRuns: 200, examples: [[1, []], [0xffff_ffff, [0, 1]]] });
});

it('rejects OIDs outside the enterprise root or without a numeric PEN', () => {
  const suffix = fc.string({ maxLength: 128 });
  fc.assert(fc.property(suffix, (tail) => {
    expect(extractEnterprisePen(`1.3.6.1.2.1.${tail}`)).toBeNull();
    expect(extractEnterprisePen(`${enterpriseRoot}.lab${tail}`)).toBeNull();
  }), { ...replay, numRuns: 200, examples: [[''], ['.123']] });
});

it('falls back to a generic trap for incomplete decoded PDUs', () => {
  const value = fc.jsonValue({ maxDepth: 3 });
  const pdu = fc.oneof(
    fc.constant(null),
    fc.record({ varbinds: fc.oneof(fc.string(), fc.integer(), fc.constant(null)) }),
    fc.record({
      varbinds: fc.array(fc.record({ oid: fc.constant(''), type: value, value }), { maxLength: 12 }),
    }),
  );
  fc.assert(fc.property(pdu, (payload) => {
    const decoded = decodeSnmpTrap({ pdu: payload, rinfo: { address: sourceIp, port: 162 } }, { receivedAtMs });
    expect(decoded).toMatchObject({
      senderIp: sourceIp,
      trapOid: '1.3.6.1.6.3.1.1.5.0',
      receivedAtMs,
    });
    const count = Array.isArray(payload?.varbinds) ? payload.varbinds.length : 0;
    expect(decoded.varbinds).toHaveLength(count);
  }), { ...replay, numRuns: 200, examples: [[null], [{ varbinds: 'incomplete' }], [{ varbinds: [] }]] });
});

it('rejects oversized input at the byte limit before deduplication', () => {
  const size = fc.integer({ min: 0, max: 65_507 });
  fc.assert(fc.property(size, (bytes) => {
    const guard = createSnmpIngestionGuard({ maxPayloadBytes: 2048 });
    expect(guard.evaluatePreParse(bytes, sourceIp, receivedAtMs)).toEqual(
      bytes <= 2048 ? { allow: true } : { allow: false, dropReason: 'payload_oversized' },
    );
  }), { ...replay, numRuns: 200, examples: [[2047], [2048], [2049], [65_507]] });
});

it('redacts synthetic community markers in JSON and incomplete captures', () => {
  fc.assert(fc.property(fc.nat(), fc.boolean(), (id, complete) => {
    const marker = `synthetic-community-${id}`;
    const json = JSON.stringify({ community: marker, senderIp: sourceIp });
    const capture = sanitizeSnmpCapture(complete ? json : json.slice(0, -1));
    expect(capture).not.toContain(marker);
    expect(capture).toContain(sourceIp);
  }), { ...replay, numRuns: 200, examples: [[0, true], [1, false]] });
});

it('decodes varbinds and keeps normalization scoped to the sender tenant', () => {
  const oid = fc.oneof(
    fc.constant('1.3.6.1.6.3.1.1.5.3'),
    fc.integer({ min: 1, max: 9999 }).map((arc) => `${enterpriseRoot}.32473.0.${arc}`),
  );
  fc.assert(fc.property(oid, fc.uint8Array({ maxLength: 256 }), fc.nat(), (trapOid, bytes, id) => {
    const fixtureMarker = `synthetic-community-${id}`;
    const decoded = decodeSnmpTrap({
      pdu: {
        type: PduType.TrapV2,
        id,
        varbinds: [
          { oid: '1.3.6.1.6.3.1.1.4.1.0', type: ObjectType.OID, value: trapOid },
          { oid: '1.3.6.1.4.1.32473.1.0', type: ObjectType.OctetString, value: Buffer.from(bytes) },
        ],
      },
      rinfo: { address: sourceIp, port: 162 },
      community: fixtureMarker,
    }, { receivedAtMs });
    expect(decoded).toMatchObject({ trapOid, requestId: id, senderIp: sourceIp, receivedAtMs });

    const evidence = createRawEvidenceEnvelope(decoded);
    expect(evidence).toMatchObject({ trapOid, senderIp: sourceIp, credentialsRedacted: true });
    expect(evidence.varbinds).toHaveLength(1);
    expect(evidence.varbinds[0]?.rawHex).toBe(Buffer.from(bytes).toString('hex'));
    expect(JSON.stringify([decoded, evidence])).not.toContain(fixtureMarker);

    for (const tenantId of ['tenant-lab-a', 'tenant-lab-b']) {
      const connectionId = `connection-${tenantId}`;
      const event = parseAndNormalizeSnmpTrap(
        { ...decoded, community: fixtureMarker },
        { tenantId, connectionId, oltId: 'olt-lab' },
      );
      expect(event).toMatchObject({
        tenantId,
        source: 'snmp-trap',
        ts: '2026-01-01T00:00:00.000Z',
        tags: { connectionId },
      });
      expect(JSON.stringify(event)).not.toContain(fixtureMarker);
    }
  }), {
    ...replay,
    numRuns: 200,
    examples: [
      ['1.3.6.1.6.3.1.1.5.3', new Uint8Array(), 0],
      ['1.3.6.1.4.1.32473.0.1', Uint8Array.of(0, 255), 1],
    ],
  });
});
