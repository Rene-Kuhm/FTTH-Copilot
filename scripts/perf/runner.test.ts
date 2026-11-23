import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { runPhases, summarize } from './runner';
import type { Phase } from './profiles';

const phase: Phase = {
  name: 'test', seconds: 1, perSecond: 10, p95Ms: 95, p99Ms: 99, maxErrorRate: 0.01,
};

test('uses nearest-rank percentiles and rejects slow or empty samples', () => {
  const samples = Array.from({ length: 100 }, (_, index) => ({ ms: index + 1 })).reverse();
  const result = summarize(phase, samples);
  assert.deepEqual([result.p95Ms, result.p99Ms, result.pass], [95, 99, true]);
  assert.equal(summarize({ ...phase, p99Ms: 98 }, samples).pass, false);
  assert.equal(summarize({ ...phase, p95Ms: 94 }, samples).pass, false);
  assert.equal(summarize(phase, []).pass, false);
});

test('includes HTTP rejections and generator misses in the offered total', () => {
  const samples = Array.from({ length: 99 }, () => ({ ms: 10 }));
  assert.equal(summarize(phase, [...samples, { ms: 10, error: 'HTTP 429' }]).pass, true);
  const rejected = summarize(phase, [...samples.slice(1), ...Array.from(
    { length: 2 }, () => ({ ms: 10, error: 'HTTP 429' }),
  )]);
  assert.equal(rejected.errorRate, 0.02);
  assert.equal(rejected.pass, false);
  const missed = summarize(phase, [...samples, { ms: 10, error: 'generator missed arrival' }]);
  assert.deepEqual([missed.offered, missed.launched, missed.succeeded, missed.pass], [100, 99, 99, false]);
});

test('offers work across the phase boundary with the previous request still in flight', async (t) => {
  const log = t.mock.method(console, 'log', () => {});
  const light = { ...phase, seconds: 0.1, perSecond: 10 };
  let firstComplete = false;
  const pass = await runPhases([light, { ...light, name: 'peak' }], ['route'], 1, async (index) => {
    assert.equal(index, 0);
    await delay(300);
    firstComplete = true;
    return undefined;
  });

  assert.equal(firstComplete, true);
  assert.equal(pass, false);
  assert.deepEqual(log.mock.calls.map(({ arguments: [line] }) => JSON.parse(line).errors), [
    {}, { 'generator missed arrival': 1 },
  ]);
});
