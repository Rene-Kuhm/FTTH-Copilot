import assert from 'node:assert/strict';
import { test } from 'node:test';
import { escapeLogField, formatMockNmsLog } from '../lib/log-field.ts';

test('preserves ordinary request paths and escapes raw lines and terminal controls', () => {
  assert.equal(escapeLogField('/smartolt/api/system/get_olts'), '/smartolt/api/system/get_olts');
  assert.equal(
    escapeLogField('/mock\r\n\u001b\u0085\u2028\u202e'),
    '/mock\\r\\n\\u001b\\u0085\\u2028\\u202e',
  );
});

test('formats a request as one JSON line with escaped controls and a numeric status', () => {
  const line = formatMockNmsLog('GET\r\n', '/mock"\\\u001b\u2028', 404);

  assert.doesNotMatch(line, /[\r\n\u001b\u2028]/);
  assert.deepEqual(JSON.parse(line), {
    method: 'GET\\r\\n',
    path: '/mock"\\\\u001b\\u2028',
    status: 404,
  });
});
