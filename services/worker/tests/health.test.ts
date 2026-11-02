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
      ['ftth-poll', { completed: 3, failed: 1, retried: 2 }],
      ['ftth-firmware', { completed: 0, failed: 0, retried: 0 }],
      ['ftth-fec', { completed: 7, failed: 0, retried: 0 }],
      ['ftth-ingest', { completed: 0, failed: 0, retried: 0 }],
    ]),
    latency: new Map([
      [
        'ftth-poll',
        {
          buckets: [1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2],
          sum: 1.25,
          count: 2,
        },
      ],
    ]),
    queueDepth: async () => ({
      depths: new Map([
        [
          'ftth-poll',
          {
            waiting: 4,
            active: 1,
            delayed: 0,
            prioritized: 0,
            'waiting-children': 0,
            completed: 12,
            failed: 1,
          },
        ],
        [
          'ftth-firmware',
          {
            waiting: 0,
            active: 0,
            delayed: 2,
            prioritized: 0,
            'waiting-children': 0,
            completed: 3,
            failed: 0,
          },
        ],
      ]),
      unavailable: ['ftth-fec', 'ftth-ingest'],
    }),
    ingest: {
      syslogBound: true,
      syslogExpected: true,
      syslogLastError: null,
      snmpBound: true,
      snmpExpected: true,
      snmpLastError: null,
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
    counters: new Map(QUEUES.map((queue) => [queue, { completed: 0, failed: 0, retried: 0 }])),
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
      snmpBound: true,
      snmpExpected: true,
      snmpLastError: null,
      backlog: 3,
      dropped: 1,
      deadLettered: 2,
      rateLimited: 4,
    });
  });

  it('reports the state of the SNMP receiver', async () => {
    const response = await fetch(`${baseUrl}/healthz`);
    const body = await response.json();

    // The trap receiver is a second socket: the operator has to know that
    // it is down without asking the trap pipeline.
    expect(body.ingest.snmpBound).toBe(true);
    expect(body.ingest.snmpExpected).toBe(true);
    expect(body.ingest.snmpLastError).toBeNull();
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

  it('exposes the depth of every queue', async () => {
    const response = await fetch(`${baseUrl}/metrics`);
    const body = await response.text();

    expect(body).toContain('# TYPE ftth_copilot_worker_queue_depth gauge');
    // 4 waiting + 1 active.
    expect(body).toContain('ftth_copilot_worker_queue_depth{queue="ftth-poll"} 5');
    // 2 delayed.
    expect(body).toContain('ftth_copilot_worker_queue_depth{queue="ftth-firmware"} 2');
  });

  it('exposes the jobs of a queue by state', async () => {
    const response = await fetch(`${baseUrl}/metrics`);
    const body = await response.text();

    expect(body).toContain('ftth_copilot_worker_queue_jobs{queue="ftth-poll",state="waiting"} 4');
    expect(body).toContain('ftth_copilot_worker_queue_jobs{queue="ftth-poll",state="active"} 1');
    expect(body).toContain('ftth_copilot_worker_queue_jobs{queue="ftth-poll",state="failed"} 1');
    expect(body).toContain('ftth_copilot_worker_queue_jobs{queue="ftth-poll",state="completed"} 12');
  });

  it('says which queues could not be counted', async () => {
    const response = await fetch(`${baseUrl}/metrics`);
    const body = await response.text();

    // A queue nobody could count must not look like an empty queue: the
    // depth reads zero and this gauge says the zero is not a measurement.
    expect(body).toContain('ftth_copilot_worker_queue_depth_readable{queue="ftth-poll"} 1');
    expect(body).toContain('ftth_copilot_worker_queue_depth_readable{queue="ftth-fec"} 0');
    expect(body).toContain('ftth_copilot_worker_queue_depth{queue="ftth-fec"} 0');
  });

  it('exposes the latency of the jobs as a histogram', async () => {
    const response = await fetch(`${baseUrl}/metrics`);
    const body = await response.text();

    expect(body).toContain('# TYPE ftth_copilot_worker_job_duration_seconds histogram');
    expect(body).toContain('ftth_copilot_worker_job_duration_seconds_count{queue="ftth-poll"} 2');
    expect(body).toContain('ftth_copilot_worker_job_duration_seconds_sum{queue="ftth-poll"} 1.2500');
    expect(body).toContain('ftth_copilot_worker_job_duration_seconds_bucket{queue="ftth-poll",le="+Inf"} 2');
    expect(body).toMatch(
      /ftth_copilot_worker_job_duration_seconds_bucket\{queue="ftth-poll",le="0\.05"\} 1/,
    );
  });

  it('exposes the retries as a counter', async () => {
    const response = await fetch(`${baseUrl}/metrics`);
    const body = await response.text();

    expect(body).toContain('# TYPE ftth_copilot_worker_jobs_retried_total counter');
    expect(body).toContain('ftth_copilot_worker_jobs_retried_total{queue="ftth-poll"} 2');
  });

  it('exposes the dead-letter of the ingest path', async () => {
    const response = await fetch(`${baseUrl}/metrics`);
    const body = await response.text();

    // The events that could not be stored are recoverable with
    // `pnpm replay:dead-letter`, so their number has to be visible.
    expect(body).toContain('# TYPE ftth_copilot_worker_ingest_dead_lettered_total counter');
    expect(body).toContain('ftth_copilot_worker_ingest_dead_lettered_total 2');
    expect(body).toContain('ftth_copilot_worker_ingest_dropped_total 1');
    expect(body).toContain('ftth_copilot_worker_ingest_rate_limited_total 4');
  });
});

describe('GET /metrics with a bearer token', () => {
  let server: HealthServerHandle;
  let baseUrl: string;

  beforeAll(async () => {
    server = await startHealthServer({
      runtime: healthyRuntime(),
      port: 0,
      host: '127.0.0.1',
      metricsToken: 'shared-secret',
    });
    baseUrl = `http://127.0.0.1:${server.port}`;
  });

  afterAll(async () => {
    await server.close();
  });

  it('rejects a request without the token', async () => {
    const response = await fetch(`${baseUrl}/metrics`);

    expect(response.status).toBe(401);
  });

  it('rejects a request with the wrong token', async () => {
    const response = await fetch(`${baseUrl}/metrics`, {
      headers: { authorization: 'Bearer wrong' },
    });

    expect(response.status).toBe(401);
  });

  it('accepts a request with the token', async () => {
    const response = await fetch(`${baseUrl}/metrics`, {
      headers: { authorization: 'Bearer shared-secret' },
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('ftth_copilot_worker_uptime_seconds');
  });

  it('leaves the health endpoint open for the probes', async () => {
    const response = await fetch(`${baseUrl}/healthz`);

    expect(response.status).toBe(200);
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
      snmpBound: false,
      snmpExpected: false,
      snmpLastError: null,
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
