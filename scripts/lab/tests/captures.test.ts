import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CAPTURES,
  LIBRENMS_COMMIT,
  captureRelativePath,
  captureUrl,
  communityFor,
  missingCaptures,
} from '../lib/captures.ts';

test('the snmpsim community is the file name without .snmprec', () => {
  assert.equal(communityFor('smartax.snmprec'), 'smartax');
  assert.equal(communityFor('fiberhome_an5516-04b.snmprec'), 'fiberhome_an5516-04b');
  assert.equal(communityFor('vsolution_v1600d.snmprec'), 'vsolution_v1600d');
});

test('communityFor rejects a file snmpsim cannot serve by community', () => {
  assert.throws(() => communityFor('smartax.txt'), /not an snmpsim data file/);
  assert.throws(() => communityFor('.snmprec'), /not an snmpsim data file/);
});

test('captureUrl points at the pinned commit and at LibreNMS tests/snmpsim', () => {
  assert.equal(
    captureUrl('zxa10_c600.snmprec'),
    `https://raw.githubusercontent.com/librenms/librenms/${LIBRENMS_COMMIT}/tests/snmpsim/zxa10_c600.snmprec`,
  );
  assert.equal(
    captureUrl('zxa10_c600.snmprec', 'deadbeef'),
    'https://raw.githubusercontent.com/librenms/librenms/deadbeef/tests/snmpsim/zxa10_c600.snmprec',
  );
});

test('the pinned commit is a 40 character hexadecimal SHA', () => {
  assert.match(LIBRENMS_COMMIT, /^[0-9a-f]{40}$/);
});

test('captureRelativePath keeps the capture in the gitignored bench directory', () => {
  assert.equal(captureRelativePath('smartax.snmprec'), 'docker/lab/captures/smartax.snmprec');
});

test('the manifest covers Huawei, ZTE, FiberHome and V-SOL', () => {
  const vendors = new Set(CAPTURES.map((entry) => entry.vendor));
  for (const vendor of ['Huawei', 'ZTE', 'FiberHome', 'V-SOL']) {
    assert.ok(vendors.has(vendor), `no capture from ${vendor}`);
  }
  assert.ok(
    CAPTURES.some((entry) => entry.file.startsWith('smartax')),
    'the SmartAX family is missing',
  );
  assert.ok(
    CAPTURES.some((entry) => entry.file.startsWith('zxa10')),
    'the ZXA10 family is missing',
  );
  assert.ok(
    CAPTURES.some((entry) => entry.file.startsWith('fiberhome_an5516')),
    'the AN5516 family is missing',
  );
  assert.ok(
    CAPTURES.some((entry) => entry.file.startsWith('vsolution')),
    'the V-SOL capture is missing',
  );
});

test('every manifest capture has a .snmprec file and a unique community', () => {
  const communities = new Set<string>();
  for (const entry of CAPTURES) {
    assert.ok(entry.file.endsWith('.snmprec'), `${entry.file} is not a .snmprec file`);
    const community = communityFor(entry.file);
    assert.ok(!communities.has(community), `repeated community: ${community}`);
    communities.add(community);
  }
});

test('missingCaptures returns only the absent captures', () => {
  const present = CAPTURES.slice(0, 2).map((entry) => entry.file);
  const missing = missingCaptures(present);
  assert.equal(missing.length, CAPTURES.length - 2);
  assert.deepEqual(
    missing.map((entry) => entry.file),
    CAPTURES.slice(2).map((entry) => entry.file),
  );
  assert.deepEqual(missingCaptures(CAPTURES.map((entry) => entry.file)), []);
});
