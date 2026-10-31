import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_HEALTH_HOST,
  DEFAULT_HEALTH_PORT,
  PROMETHEUS_CONTENT_TYPE,
  buildHealthPayload,
  renderPrometheusMetrics,
  resolveHealthServerOptions,
  startHealthServer,
  type HealthServerHandle,
  type WorkerRuntime,
} from '../src/health';

/**
 * The health/metrics server is exercised through its public HTTP interface
 * only — the tests never import internals, so they keep working when the
 * implementation changes shape.
 *
 * The server binds to port 0 (ephemeral): the test never collides with a
 * running worker instance, and two suites can run side by side.
 */

const QUEUES = ['ftth-poll', 'ftth-firmware', 'ftth-fec', 'ftth-ingest'];

/**
 * A runtime state as the worker fleet would report it: Redis reachable and
 * every queue already consumed.
 */
function healthyRuntime(): WorkerRuntime {
  return {
    queues: QUEUES,
    redisReady: true,
    startedAtMs: Date.now() - 5_000,
    counters: new Map([
      ['ftth-poll', { completed: 3, failed: 1 }],
      ['ftth-firmware', { completed: 0, failed: 0 }],
      ['ftth-fec', { completed: 7, failed: 0 }],
      ['ftth-ingest', { completed: 0, failed: 0 }],
    ]),
    ingest: {
      syslogBound: true,
      syslogExpected: true,
      syslogLastError: null,
      backlog: 3,
      dropped: 1,
      deadLettered: 2,
      rateLimited: 4,
    },
  };
}

/**
 * The same fleet while Redis is unreachable: no queue is ready and no job
 * has been executed.
 */
function degradedRuntime(): WorkerRuntime {
  return {
    queues: QUEUES,
    redisReady: false,
    startedAtMs: Date.now() - 5_000,
    counters: new Map(QUEUES.map((queue) => [queue, { completed: 0, failed: 0 }])),
  };
}

describe('GET /healthz', () => {
  let server: HealthServerHandle;
  let baseUrl: string;

  beforeAll(async () => {
    server = await startHealthServer({ runtime: healthyRuntime(), port: 0, host: '127.0.0.1' });
    baseUrl = `http://127.0.0.1:${server.port}`;
  });

  afterAll(async () => {
    await server.close();
  });

  it('answers 200 with the health payload', async () => {
    const response = await fetch(`${baseUrl}/healthz`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
  });

  it('reports uptime, consumed queues, Redis readiness and the status', async () => {
    const response = await fetch(`${baseUrl}/healthz`);
    const body = await response.json();

    expect(body.status).toBe('ok');
    expect(body.redisReady).toBe(true);
    expect(body.queues).toEqual(QUEUES);
    expect(typeof body.uptimeSeconds).toBe('number');
    expect(body.uptimeSeconds).toBeGreaterThanOrEqual(5);
    expect(Number.isNaN(Date.parse(body.startedAt))).toBe(false);
  });

  it('reports the state of the syslog receiver and of the durable spool', async () => {
    const response = await fetch(`${baseUrl}/healthz`);
    const body = await response.json();

    // A socket that failed to bind must not be invisible: that was the
    // original bug report ("el puerto syslog puede estar ocupado y el
    // error no queda informado").
    expect(body.ingest).toEqual({
      syslogBound: true,
      syslogExpected: true,
      syslogLastError: null,
      backlog: 3,
      dropped: 1,
      deadLettered: 2,
      rateLimited: 4,
    });
  });
});

describe('GET /metrics', () => {
  let server: HealthServerHandle;
  let baseUrl: string;

  beforeAll(async () => {
    server = await startHealthServer({ runtime: healthyRuntime(), port: 0, host: '127.0.0.1' });
    baseUrl = `http://127.0.0.1:${server.port}`;
  });

  afterAll(async () => {
    await server.close();
  });

  it('answers 200 with the Prometheus exposition content type', async () => {
    const response = await fetch(`${baseUrl}/metrics`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe(PROMETHEUS_CONTENT_TYPE);
    expect(PROMETHEUS_CONTENT_TYPE).toBe('text/plain; version=0.0.4; charset=utf-8');
  });

  it('exposes the worker uptime and the per-queue counters', async () => {
    const response = await fetch(`${baseUrl}/metrics`);
    const body = await response.text();

    expect(body).toContain('# TYPE ftth_copilot_worker_uptime_seconds gauge');
    expect(body).toMatch(/^ftth_copilot_worker_uptime_seconds \d+\.\d{3}$/m);
    expect(body).toContain('ftth_copilot_worker_jobs_completed_total{queue="ftth-poll"} 3');
    expect(body).toContain('ftth_copilot_worker_jobs_failed_total{queue="ftth-poll"} 1');
    expect(body).toContain('ftth_copilot_worker_jobs_completed_total{queue="ftth-fec"} 7');
    expect(body.endsWith('\n')).toBe(true);
  });

  it('reports the Redis readiness as a gauge', async () => {
    const response = await fetch(`${baseUrl}/metrics`);
    const body = await response.text();

    expect(body).toContain('ftth_copilot_worker_redis_ready 1');
  });

  it('exposes the spool backlog as a gauge', async () => {
    const response = await fetch(`${baseUrl}/metrics`);
    const body = await response.text();

    // A growing backlog has to be visible before it becomes data loss.
    expect(body).toContain('# TYPE ftth_copilot_worker_ingest_spool_backlog gauge');
    expect(body).toContain('ftth_copilot_worker_ingest_spool_backlog 3');
  });
});

describe('when Redis is unreachable', () => {
  let server: HealthServerHandle;
  let baseUrl: string;

  beforeAll(async () => {
    server = await startHealthServer({ runtime: degradedRuntime(), port: 0, host: '127.0.0.1' });
    baseUrl = `http://127.0.0.1:${server.port}`;
  });

  afterAll(async () => {
    await server.close();
  });

  it('still answers 200 — an invisible worker is worse than a degraded one', async () => {
    const response = await fetch(`${baseUrl}/healthz`);

    expect(response.status).toBe(200);
  });

  it('reports the degraded status instead of failing', async () => {
    const response = await fetch(`${baseUrl}/healthz`);
    const body = await response.json();

    expect(body.status).toBe('degraded');
    expect(body.redisReady).toBe(false);
    expect(body.queues).toEqual(QUEUES);
  });

  it('still exposes the metrics with the readiness gauge at zero', async () => {
    const response = await fetch(`${baseUrl}/metrics`);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('ftth_copilot_worker_redis_ready 0');
    expect(body).toContain('ftth_copilot_worker_jobs_completed_total{queue="ftth-poll"} 0');
  });

  it('reports a zeroed ingest state when the worker owns no ingest path', async () => {
    const response = await fetch(`${baseUrl}/healthz`);
    const body = await response.json();

    expect(body.ingest).toEqual({
      syslogBound: false,
      syslogExpected: false,
      syslogLastError: null,
      backlog: 0,
      dropped: 0,
      deadLettered: 0,
      rateLimited: 0,
    });
  });
});

describe('unknown routes', () => {
  let server: HealthServerHandle;
  let baseUrl: string;

  beforeAll(async () => {
    server = await startHealthServer({ runtime: healthyRuntime(), port: 0, host: '127.0.0.1' });
    baseUrl = `http://127.0.0.1:${server.port}`;
  });

  afterAll(async () => {
    await server.close();
  });

  it('answer 404 instead of falling back to the health payload', async () => {
    const response = await fetch(`${baseUrl}/nope`);

    expect(response.status).toBe(404);
  });
});

describe('the HTTP contract of the server', () => {
  let server: HealthServerHandle;
  let baseUrl: string;

  beforeAll(async () => {
    server = await startHealthServer({ runtime: healthyRuntime(), port: 0, host: '127.0.0.1' });
    baseUrl = `http://127.0.0.1:${server.port}`;
  });

  afterAll(async () => {
    await server.close();
  });

  it('rejects a write method with 405', async () => {
    const response = await fetch(`${baseUrl}/healthz`, { method: 'POST' });

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET, HEAD');
  });

  it('answers a HEAD probe with the headers and no body', async () => {
    const response = await fetch(`${baseUrl}/healthz`, { method: 'HEAD' });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('');
  });

  it('ignores the query string of the path', async () => {
    const response = await fetch(`${baseUrl}/healthz?probe=1`);

    expect(response.status).toBe(200);
    expect((await response.json()).status).toBe('ok');
  });

  it('fails fast when the port is already taken', async () => {
    await expect(
      startHealthServer({ runtime: healthyRuntime(), port: server.port, host: '127.0.0.1' }),
    ).rejects.toThrow();
  });
});

describe('the bind options', () => {
  it('defaults to the port and host the compose file expects', () => {
    expect(resolveHealthServerOptions({})).toEqual({
      port: DEFAULT_HEALTH_PORT,
      host: DEFAULT_HEALTH_HOST,
    });
  });

  it('keeps the explicit options', () => {
    expect(resolveHealthServerOptions({ port: 0, host: '127.0.0.1' })).toEqual({
      port: 0,
      host: '127.0.0.1',
    });
  });
});

describe('the rendered metrics', () => {
  it('counts a queue without counters as zero', () => {
    const runtime: WorkerRuntime = {
      queues: ['ftth-poll'],
      redisReady: true,
      startedAtMs: Date.now(),
      counters: new Map(),
    };

    const body = renderPrometheusMetrics(runtime);

    expect(body).toContain('ftth_copilot_worker_jobs_completed_total{queue="ftth-poll"} 0');
    expect(body).toContain('ftth_copilot_worker_jobs_failed_total{queue="ftth-poll"} 0');
    expect(body).toContain('ftth_copilot_worker_queues_consumed 1');
  });

  it('never reports a negative uptime', () => {
    const runtime: WorkerRuntime = {
      queues: [],
      redisReady: false,
      startedAtMs: Date.now() + 60_000,
      counters: new Map(),
    };

    expect(buildHealthPayload(runtime).uptimeSeconds).toBe(0);
    expect(renderPrometheusMetrics(runtime)).toContain('ftth_copilot_worker_uptime_seconds 0.000');
  });

  it('escapes the label of a queue', () => {
    const runtime: WorkerRuntime = {
      queues: ['weird"queue'],
      redisReady: true,
      startedAtMs: Date.now(),
      counters: new Map([['weird"queue', { completed: 1, failed: 0 }]]),
    };

    const body = renderPrometheusMetrics(runtime);

    expect(body).toContain('ftth_copilot_worker_queue_consuming{queue="weird\\"queue"} 1');
    expect(body).toContain('ftth_copilot_worker_jobs_completed_total{queue="weird\\"queue"} 1');
  });
});
