import assert from 'node:assert/strict';
import { test } from 'node:test';

import { decodeGetResponse, decodeOid, encodeGetRequest, encodeOid, snmpGet } from '../lib/snmp.ts';

/** Real `GetResponse` captured from snmpsim serving the LibreNMS `smartax` capture. */
const SMARTDESCR_RESPONSE_HEX =
  '30490201010407736d6172746178a23b02021092020100020100302f302d06082b060102010101000421487561776569204' +
  '96e74656772617465642041636365737320536f667477617265';

/** `GetResponse` whose OCTET STRING is NUL padded, as some agents send it. */
const NUL_PADDED_RESPONSE_HEX = '302a02010104067075626c6963a21d0201010201000201003012301006082b06010201010100040461626300';

/** `GetResponse` for a `noSuchObject`: the agent does not know the OID. */
const NO_SUCH_OBJECT_RESPONSE_HEX =
  '302602010104067075626c6963a219020101020100020100300e300c06082b060102010101008000';

test('encodeGetRequest produces the exact v2c message the bench sends', () => {
  const request = encodeGetRequest('smartax', '1.3.6.1.2.1.1.1.0', 4242);
  assert.equal(
    request.toString('hex'),
    '30280201010407736d6172746178a01a02021092020100020100300e300c06082b060102010101000500',
  );
});

test('decodeGetResponse reads a real snmpsim response', () => {
  const response = decodeGetResponse(Buffer.from(SMARTDESCR_RESPONSE_HEX, 'hex'));
  assert.equal(response.requestId, 4242);
  assert.equal(response.errorStatus, 0);
  assert.equal(response.errorIndex, 0);
  assert.deepEqual(response.varBinds, [
    { oid: '1.3.6.1.2.1.1.1.0', value: 'Huawei Integrated Access Software' },
  ]);
});

test('decodeGetResponse strips the NUL padding some agents append', () => {
  const response = decodeGetResponse(Buffer.from(NUL_PADDED_RESPONSE_HEX, 'hex'));
  assert.equal(response.varBinds[0]?.value, 'abc');
});

test('decodeGetResponse rejects a noSuchObject answer instead of returning empty', () => {
  const buffer = Buffer.from(NO_SUCH_OBJECT_RESPONSE_HEX, 'hex');
  assert.throws(() => decodeGetResponse(buffer), /noSuchObject/);
});

test('encodeOid encodes the sysDescr OID and large arcs', () => {
  assert.equal(encodeOid('1.3.6.1.2.1.1.1.0').toString('hex'), '2b06010201010100');
  const enterprise = '1.3.6.1.4.1.5875.800.1001.11';
  assert.equal(decodeOid(encodeOid(enterprise)), enterprise);
});

test('encodeOid rejects a non numeric OID', () => {
  assert.throws(() => encodeOid('1'), /not an OID/);
  assert.throws(() => encodeOid('a.b'), /not a numeric OID/);
  assert.throws(() => encodeOid('3.1.2'), /first OID arc is 0, 1 or 2/);
});

test('snmpGet fails with a clear error when nobody answers', async () => {
  // Loopback port 1: nothing listens there, and no snmpsim agent answers.
  await assert.rejects(
    snmpGet({
      host: '127.0.0.1',
      port: 1,
      community: 'no-such-community',
      oid: '1.3.6.1.2.1.1.1.0',
      timeoutMs: 150,
      attempts: 1,
    }),
    /no SNMP response|ECONNREFUSED|socket/i,
  );
});
