import assert from 'node:assert/strict';
import { test } from 'node:test';
import { escapeLogField } from '../lib/log-field.ts';

test('preserves ordinary request paths and escapes raw lines and terminal controls', () => {
  assert.equal(escapeLogField('/smartolt/api/system/get_olts'), '/smartolt/api/system/get_olts');
  assert.equal(
    escapeLogField('/mock\r\n\u001b\u0085\u2028\u202e'),
    '/mock\\r\\n\\u001b\\u0085\\u2028\\u202e',
  );
});
