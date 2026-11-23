import assert from 'node:assert/strict';
import { test } from 'node:test';

import { firstOid, parseSysDescr } from '../lib/snmprec.ts';

test('parseSysDescr returns the sysDescr of a real capture', () => {
  const content = [
    '1.3.6.1.2.1.1.1.0|4|ZXA10 C620, ZTE ZXA10 Software Version: V1.2.2',
    '1.3.6.1.2.1.1.2.0|6|1.3.6.1.4.1.3902.1082.1001.620.1.1',
    '',
  ].join('\n');
  assert.equal(parseSysDescr(content), 'ZXA10 C620, ZTE ZXA10 Software Version: V1.2.2');
});

test('parseSysDescr finds the OID even when it is not the first line', () => {
  const content = [
    '1.0.8802.1.1.2.1.3.7.1.3.234938368|4|ethernet0/7/0',
    '1.3.6.1.2.1.1.1.0|4|Huawei Integrated Access Software',
  ].join('\n');
  assert.equal(parseSysDescr(content), 'Huawei Integrated Access Software');
});

test('parseSysDescr keeps the pipes inside the value', () => {
  const content = '1.3.6.1.2.1.1.1.0|4|Vendor|Model v1.0';
  assert.equal(parseSysDescr(content), 'Vendor|Model v1.0');
});

test('parseSysDescr discards a value redacted by LibreNMS', () => {
  assert.equal(parseSysDescr('1.3.6.1.2.1.1.1.0|4|<private>'), null);
});

test('parseSysDescr discards a sysDescr that is not an OCTET STRING', () => {
  assert.equal(parseSysDescr('1.3.6.1.2.1.1.1.0|6|1.3.6.1.4.1.5875.800'), null);
});

test('parseSysDescr returns null when the capture has no sysDescr', () => {
  const content = '1.3.6.1.2.1.1.2.0|6|1.3.6.1.4.1.3902';
  assert.equal(parseSysDescr(content), null);
  assert.equal(parseSysDescr(''), null);
});

test('firstOid returns the first OID of the capture', () => {
  assert.equal(firstOid('1.3.6.1.2.1.1.1.0|4|AN5516-01\n'), '1.3.6.1.2.1.1.1.0');
  assert.equal(firstOid(''), null);
});
