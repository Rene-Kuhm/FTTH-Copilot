import { afterEach, describe, expect, it } from 'vitest';
import { __setLogSinkForTests, correlationIdFrom } from '@ftth-copilot/shared';
import { logRequest } from '@/lib/logging';

afterEach(() => __setLogSinkForTests(null));

describe('request logging', () => {
  it('records request context and the appropriate severity without exposing headers', () => {
    const lines: string[] = [];
    __setLogSinkForTests((line) => lines.push(line));
    const headers = new Headers({ 'x-request-id': 'request-123', authorization: 'Bearer secret' });
    logRequest('POST', '/api/chat', 503, 42, { correlationId: correlationIdFrom(headers), tenantId: 'tenant-1' });
    expect(JSON.parse(lines[0]!)).toMatchObject({ level: 'error', name: 'http-request', correlationId: 'request-123', tenantId: 'tenant-1', status: 503, durationMs: 42 });
    expect(lines[0]).not.toContain('secret');
  });
});
