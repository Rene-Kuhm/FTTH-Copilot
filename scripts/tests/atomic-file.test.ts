import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { writeAtomicFile } from '../lib/atomic-file.ts';

test('publishes an initial .env privately and preserves a concurrent winner', (t) => {
  const directory = fs.mkdtempSync(path.join(import.meta.dirname, '.atomic-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const destination = path.join(directory, '.env');

  writeAtomicFile(destination, 'FIRST=synthetic\n', { mode: 0o600, exclusive: true });
  assert.throws(
    () => writeAtomicFile(destination, 'SECOND=synthetic\n', { mode: 0o600, exclusive: true }),
    { code: 'EEXIST' },
  );
  assert.equal(fs.readFileSync(destination, 'utf8'), 'FIRST=synthetic\n');
  assert.equal(fs.statSync(destination).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(directory), ['.env']);
});

test('updates a secret file by replacing the directory entry without writing through a symlink', (t) => {
  const directory = fs.mkdtempSync(path.join(import.meta.dirname, '.atomic-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const target = path.join(directory, 'target');
  const destination = path.join(directory, '.env');
  fs.writeFileSync(target, 'ORIGINAL=synthetic\n');
  fs.symlinkSync(target, destination);

  writeAtomicFile(destination, 'UPDATED=synthetic\n', { mode: 0o600 });
  assert.equal(fs.readFileSync(target, 'utf8'), 'ORIGINAL=synthetic\n');
  assert.equal(fs.readFileSync(destination, 'utf8'), 'UPDATED=synthetic\n');
  assert.equal(fs.lstatSync(destination).mode & 0o777, 0o600);
});
