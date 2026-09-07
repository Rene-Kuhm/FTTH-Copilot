import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  __resetSchedulerHealth,
  markExpected,
  markNotExpected,
  recordError,
  recordSuccess,
  recordSyslogBound,
} from '@/lib/monitoring/scheduler-health';
import { GET } from '@/app/api/health/route';

/**
 * Tests for `apps/web/app/api/health/route.ts`.
 *
 * Contract:
 *   - 200 with `status: 'ok'` when no scheduler service is unhealthy.
 *   - 200 with `status: 'ok'` when no service is expected at all.
 *   - 503 with `status: 'degraded'` when an expected service has a
 *     recent error.
 *   - 503 when an expected service has never run.
 *   - 503 when syslog is expected but never bound.
 *   - 200 once the error window has elapsed (recovery).
 *   - Response shape includes `uptime`, `memory`, `version`,
 *     `services` keyed by service name, and `timestamp`.
 *
 * The health route does not consult auth (`getCurrentUser`) so the
 * tests do not need to mock it.
 */

beforeEach(() => {
  __resetSchedulerHealth();
});

afterEach(() => {
  __resetSchedulerHealth();
});

describe('GET /api/health', () => {
  it('returns 200 ok when nothing is expected', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.services).toEqual({});
    expect(typeof body.timestamp).toBe('string');
    expect(typeof body.uptime).toBe('number');
  });

  it('returns 200 ok when an expected service has run cleanly', async () => {
    markExpected('polling');
    recordSuccess('polling', Date.now());
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.services['polling']?.expected).toBe(true);
    expect(body.services['polling']?.lastError).toBeNull();
  });

  it('returns 503 degraded when an expected service has a recent error', async () => {
    markExpected('polling');
    recordSuccess('polling', Date.now() - 60_000);
    recordError('polling', 'NMS down', Date.now() - 1_000);
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe('degraded');
    expect(body.services['polling']?.lastError).toBe('NMS down');
  });

  it('returns 503 when an expected service has never run', async () => {
    markExpected('polling');
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe('degraded');
  });

  it('returns 503 when syslog is expected but never bound', async () => {
    markExpected('syslog');
    recordSyslogBound(false);
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe('degraded');
  });

  it('returns 200 once the error window has elapsed', async () => {
    markExpected('polling');
    recordError('polling', 'transient failure', Date.now() - 10 * 60 * 1000);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
  });

  it('returns 200 when a non-expected service has errors (operator did not opt in)', async () => {
    markNotExpected('firmware');
    recordError('firmware', 'should be ignored', Date.now() - 1_000);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
  });

  it('returns the response shape expected by the dashboard', async () => {
    const res = await GET();
    const body = await res.json();
    expect(body).toMatchObject({
      status: expect.stringMatching(/^(ok|degraded)$/),
      timestamp: expect.any(String),
      uptime: expect.any(Number),
      memory: {
        rss: expect.any(Number),
        heapUsed: expect.any(Number),
      },
      version: expect.any(String),
      services: expect.any(Object),
    });
  });
});
