import assert from 'node:assert/strict';
import { test } from 'node:test';

import { errorDetail, formatCheckResult, summarize } from '../lib/check-report.ts';

test('formatCheckResult marks PASS and keeps the observed detail', () => {
  assert.equal(
    formatCheckResult({ name: 'bbsim-rest', ok: true, detail: 'OLT BBSIM_OLT_0, 4 PON ports' }),
    '[PASS] bbsim-rest: OLT BBSIM_OLT_0, 4 PON ports',
  );
});

test('formatCheckResult marks FAIL and renders the error on one line', () => {
  assert.equal(
    formatCheckResult({
      name: 'snmpsim:smartax',
      ok: false,
      detail: 'expected "Huawei",\n  snmpsim served "ZTE"',
    }),
    '[FAIL] snmpsim:smartax: expected "Huawei", snmpsim served "ZTE"',
  );
});

test('summarize counts results and only exits 0 when everything passed', () => {
  const all = summarize([
    { name: 'a', ok: true, detail: '' },
    { name: 'b', ok: true, detail: '' },
  ]);
  assert.equal(all.passed, 2);
  assert.equal(all.failed, 0);
  assert.equal(all.exitCode, 0);
  assert.equal(all.line, '2 passed, 0 failed');

  const someFailures = summarize([
    { name: 'a', ok: true, detail: '' },
    { name: 'b', ok: false, detail: 'boom' },
  ]);
  assert.equal(someFailures.passed, 1);
  assert.equal(someFailures.failed, 1);
  assert.equal(someFailures.exitCode, 1);
  assert.equal(someFailures.line, '1 passed, 1 failed');
});

test('summarize does not exit 0 when no check ran', () => {
  const empty = summarize([]);
  assert.equal(empty.passed, 0);
  assert.equal(empty.failed, 0);
  assert.equal(empty.exitCode, 1);
});

test('errorDetail prefers the Error message', () => {
  assert.equal(errorDetail(new Error('ETIMEDOUT')), 'ETIMEDOUT');
  assert.equal(errorDetail('plain string'), 'plain string');
});
