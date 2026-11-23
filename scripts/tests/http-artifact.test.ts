import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { readArtifactText, writeArtifact } from '../lib/http-artifact.ts';

test('accepts JSON contract and raw capture media types with optional parameters', async () => {
  for (const mediaType of ['application/json', 'text/plain', 'application/octet-stream']) {
    const response = new Response('valid', { headers: { 'content-type': `${mediaType}; charset=utf-8` } });
    assert.equal(await readArtifactText(response, [mediaType], 5), 'valid');
  }
});

test('rejects HTML for contract and capture downloads', async () => {
  for (const allowed of [['application/json'], ['text/plain', 'application/octet-stream']]) {
    const response = new Response('<html>', { headers: { 'content-type': 'text/html' } });
    await assert.rejects(readArtifactText(response, allowed), /content type/);
  }
});

test('bounds both declared size and streamed bytes even with a smaller declaration', async () => {
  for (const length of ['2', '8']) {
    const response = new Response('éé', {
      headers: { 'content-type': 'text/plain', 'content-length': length },
    });
    await assert.rejects(readArtifactText(response, ['text/plain'], 3), /exceeds 3 bytes/);
  }
  const response = new Response('éé', { headers: { 'content-type': 'text/plain' } });
  await assert.rejects(readArtifactText(response, ['text/plain'], 3), /exceeds 3 bytes/);
});

test('confines publication to the expected directory and does not follow a destination symlink', (t) => {
  const root = fs.mkdtempSync(path.join(import.meta.dirname, '.artifact-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const expected = path.join(root, 'expected');
  const alias = path.join(root, 'alias');
  const outside = path.join(root, 'outside');
  const destination = path.join(expected, 'artifact');
  fs.mkdirSync(expected);
  fs.symlinkSync(expected, alias);
  fs.writeFileSync(outside, 'original');
  fs.symlinkSync(outside, destination);

  assert.throws(() => writeArtifact(expected, outside, 'download'), /expected directory/);
  assert.throws(() => writeArtifact(alias, path.join(alias, 'artifact'), 'download'), /expected directory/);
  writeArtifact(expected, destination, 'download');
  assert.equal(fs.readFileSync(outside, 'utf8'), 'original');
  assert.equal(fs.readFileSync(destination, 'utf8'), 'download');
});
