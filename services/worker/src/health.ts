/**
 * Health and metrics server of the background worker.
 *
 * Two endpoints, served by `node:http` — the worker adds no HTTP framework
 * dependency:
 *
 *   - `GET /healthz` → JSON report of the process: uptime, the queues being
 *     consumed, whether Redis is reachable and the overall status.
 *   - `GET /metrics` → Prometheus text exposition format, the same one the
 *     web already serves from `apps/web/app/api/metrics`.
 *
 * The health endpoint answers **even when Redis is unreachable**: a worker
 * that cannot be seen is worse than no worker at all. The state it reports
 * says `degraded` instead of lying with a 5xx.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { QueueDepthReport } from '@ftth-copilot/jobs';
import { QUEUE_DEPTH_STATES } from '@ftth-copilot/jobs';
import { DEFAULT_JOB_DURATION_BUCKETS_SECONDS, type QueueLatency } from './job-latency';

/**
 * Content type Prometheus expects for the text exposition format.
 *
 * Same value the web uses in `apps/web/app/api/metrics/route.ts`.
 */
export const PROMETHEUS_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';

/** Content type of the JSON health payload. */
const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';

/** Default port of the health server. */
export const DEFAULT_HEALTH_PORT = 8081;

/** Default interface the health server binds to. */
export const DEFAULT_HEALTH_HOST = '0.0.0.0';

/**
 * How long the metrics endpoint waits for the depth of the queues.
 *
 * The depth is read from Redis. When Redis is unreachable the read has to
 * fail fast: a metrics endpoint that hangs is worse than one that reports
 * "I could not read it", because the scraper would time out and the target
 * would look down.
 */
export const QUEUE_DEPTH_TIMEOUT_MS = 2_000;

/** Job counters of a single queue. */
export interface QueueCounter {
  /** Jobs that finished successfully. */
  completed: number;
  /** Jobs that failed. */
  failed: number;
  /** Failed attempts that BullMQ will retry. */
  retried: number;
}

/**
 * Live state of the ingest path.
 *
 * The syslog receiver binds a UDP port and the spool holds the events that
 * were received but not stored yet. Both have to be visible: a socket that
 * failed to bind and a backlog that grows are the two failures an operator
 * must see before they become lost telemetry.
 *
 * The SNMP receiver is the same story with a second socket: the operator has
 * to know that the trap receiver is down without asking the trap pipeline.
 */
export interface IngestRuntimeState {
  /** Whether the syslog UDP socket is bound. */
  syslogBound: boolean;
  /** Whether the syslog receiver is expected to run in this process. */
  syslogExpected: boolean;
  /** Last error recorded for the syslog service. */
  syslogLastError: string | null;
  /** Whether the SNMP UDP socket is bound. */
  snmpBound: boolean;
  /** Whether the SNMP receiver is expected to run in this process. */
  snmpExpected: boolean;
  /** Last error recorded for the SNMP service. */
  snmpLastError: string | null;
  /** Events waiting in the durable spool. */
  backlog: number;
  /** Events the spool refused (hard size limit). */
  dropped: number;
  /** Events moved to the dead-letter file. */
  deadLettered: number;
  /** Events discarded by the receiver's rate limit. */
  rateLimited: number;
}

/** The ingest state of a worker that owns no ingest path. */
const EMPTY_INGEST_STATE: IngestRuntimeState = {
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
};

/**
 * The live state of the worker fleet.
 *
 * Implemented by `src/workers.ts` (the real fleet) and by plain objects in
 * the tests. Every field is read at request time, so the report always
 * reflects the current state and never a snapshot taken at boot.
 */
export interface WorkerRuntime {
  /** Physical queue names this worker consumes. */
  readonly queues: readonly string[];
  /** True when every queue's Redis connection is established. */
  readonly redisReady: boolean;
  /** Epoch milliseconds when the process started. */
  readonly startedAtMs: number;
  /** Per-queue job counters, keyed by physical queue name. */
  readonly counters: ReadonlyMap<string, QueueCounter>;
  /**
   * Live state of the ingest path (the syslog socket and the durable
   * spool). Optional: a runtime without it reports a zeroed ingest state.
   */
  readonly ingest?: IngestRuntimeState;
  /**
   * Latency of the jobs, per queue.
   *
   * Optional: a runtime without it reports no latency at all, which is
   * different from reporting a latency of zero.
   */
  readonly latency?: ReadonlyMap<string, QueueLatency>;
  /**
   * Reads the depth of the queues from Redis.
   *
   * Optional: a runtime without it reports no depth. The read is a promise
   * because the depth lives in Redis, and a runtime that cannot reach it
   * answers with the queues it could not read.
   */
  readonly queueDepth?: () => Promise<QueueDepthReport>;
}

/** Overall status of the worker. */
export type HealthStatus = 'ok' | 'degraded';

/** Body of `GET /healthz`. */
export interface HealthPayload {
  /** `ok` when Redis is reachable, `degraded` when it is not. */
  status: HealthStatus;
  /** Seconds since the process started. */
  uptimeSeconds: number;
  /** ISO timestamp of the process start. */
  startedAt: string;
  /** Physical queue names being consumed. */
  queues: string[];
  /** Whether the Redis connection is established. */
  redisReady: boolean;
  /** State of the ingest path: the syslog socket and the durable spool. */
  ingest: IngestRuntimeState;
}

/** Options of `startHealthServer`. */
export interface HealthServerOptions {
  /** Live state of the worker fleet. */
  runtime: WorkerRuntime;
  /** Port to bind. Defaults to `DEFAULT_HEALTH_PORT`. */
  port?: number;
  /** Interface to bind. Defaults to `DEFAULT_HEALTH_HOST`. */
  host?: string;
  /**
   * Bearer token that `/metrics` requires.
   *
   * The same variable the web uses on `/api/metrics`
   * (`METRICS_BEARER_TOKEN`), so the scrape configuration of the whole
   * stack carries one credential. When it is not set, `/metrics` is open —
   * which is only safe while the server stays on the loopback.
   */
  metricsToken?: string;
}

/**
 * Resolves the bind options of the health server.
 *
 * Split from `startHealthServer` so the defaults are observable without
 * binding a port — a test must never collide with a running instance.
 */
export function resolveHealthServerOptions(options: {
  port?: number;
  host?: string;
}): { port: number; host: string } {
  return {
    port: options.port ?? DEFAULT_HEALTH_PORT,
    host: options.host ?? DEFAULT_HEALTH_HOST,
  };
}

/** A running health server. */
export interface HealthServerHandle {
  /** The underlying HTTP server. */
  server: Server;
  /** The port the server actually bound to (resolved when 0 was requested). */
  port: number;
  /** Stops the server and releases its connections. */
  close(): Promise<void>;
}

/**
 * Builds the health payload of a runtime.
 *
 * The status is derived, never taken from the caller: Redis unreachable
 * means `degraded`, everything else means `ok`.
 */
export function buildHealthPayload(runtime: WorkerRuntime, now: number = Date.now()): HealthPayload {
  return {
    status: runtime.redisReady ? 'ok' : 'degraded',
    uptimeSeconds: Number(uptimeSeconds(runtime, now).toFixed(3)),
    startedAt: new Date(runtime.startedAtMs).toISOString(),
    queues: [...runtime.queues],
    redisReady: runtime.redisReady,
    ingest: runtime.ingest ?? EMPTY_INGEST_STATE,
  };
}

/**
 * Renders the Prometheus exposition of a runtime.
 *
 * The naming follows the convention of `apps/web/lib/metrics/prometheus.ts`:
 * the `ftth_copilot_` prefix, a `# HELP` and a `# TYPE` line per family,
 * and one sample per label set.
 *
 * The depth of the queues arrives as an argument, already read from Redis:
 * the rendering stays a pure function, so a test can assert the exposition
 * without a Redis instance.
 */
export function renderPrometheusMetrics(
  runtime: WorkerRuntime,
  now: number = Date.now(),
  depth?: QueueDepthReport,
): string {
  const lines: string[] = [];

  lines.push('# HELP ftth_copilot_worker_uptime_seconds Worker process uptime in seconds.');
  lines.push('# TYPE ftth_copilot_worker_uptime_seconds gauge');
  lines.push(`ftth_copilot_worker_uptime_seconds ${uptimeSeconds(runtime, now).toFixed(3)}`);
  lines.push('');

  lines.push(
    '# HELP ftth_copilot_worker_redis_ready Whether the worker Redis connection is ready (1=ready, 0=unreachable).',
  );
  lines.push('# TYPE ftth_copilot_worker_redis_ready gauge');
  lines.push(`ftth_copilot_worker_redis_ready ${runtime.redisReady ? 1 : 0}`);
  lines.push('');

  lines.push('# HELP ftth_copilot_worker_queues_consumed Number of queues this worker consumes.');
  lines.push('# TYPE ftth_copilot_worker_queues_consumed gauge');
  lines.push(`ftth_copilot_worker_queues_consumed ${runtime.queues.length}`);
  lines.push('');

  lines.push(
    '# HELP ftth_copilot_worker_queue_consuming Whether the worker consumes a queue (1=yes, 0=no).',
  );
  lines.push('# TYPE ftth_copilot_worker_queue_consuming gauge');
  for (const queue of runtime.queues) {
    lines.push(`ftth_copilot_worker_queue_consuming{queue="${escapeLabel(queue)}"} 1`);
  }
  lines.push('');

  lines.push('# HELP ftth_copilot_worker_jobs_completed_total Cumulative jobs completed per queue.');
  lines.push('# TYPE ftth_copilot_worker_jobs_completed_total counter');
  for (const queue of runtime.queues) {
    lines.push(
      `ftth_copilot_worker_jobs_completed_total{queue="${escapeLabel(queue)}"} ${counterOf(runtime, queue).completed}`,
    );
  }
  lines.push('');

  lines.push('# HELP ftth_copilot_worker_jobs_failed_total Cumulative jobs failed per queue.');
  lines.push('# TYPE ftth_copilot_worker_jobs_failed_total counter');
  for (const queue of runtime.queues) {
    lines.push(
      `ftth_copilot_worker_jobs_failed_total{queue="${escapeLabel(queue)}"} ${counterOf(runtime, queue).failed}`,
    );
  }
  lines.push('');

  lines.push(
    '# HELP ftth_copilot_worker_jobs_retried_total Cumulative failed attempts that BullMQ will retry, per queue.',
  );
  lines.push('# TYPE ftth_copilot_worker_jobs_retried_total counter');
  for (const queue of runtime.queues) {
    lines.push(
      `ftth_copilot_worker_jobs_retried_total{queue="${escapeLabel(queue)}"} ${counterOf(runtime, queue).retried}`,
    );
  }
  lines.push('');

  // The depth of the queues: how much work is pending, and how it is
  // distributed. Without it the operator cannot tell a healthy idle worker
  // from a worker that stopped draining.
  lines.push(
    '# HELP ftth_copilot_worker_queue_depth Jobs of a queue that are not finished yet (waiting, active, delayed, prioritized and waiting-children).',
  );
  lines.push('# TYPE ftth_copilot_worker_queue_depth gauge');
  for (const queue of runtime.queues) {
    lines.push(`ftth_copilot_worker_queue_depth{queue="${escapeLabel(queue)}"} ${pendingDepth(depth, queue)}`);
  }
  lines.push('');

  lines.push(
    '# HELP ftth_copilot_worker_queue_jobs Jobs of a queue, by state.',
  );
  lines.push('# TYPE ftth_copilot_worker_queue_jobs gauge');
  for (const queue of runtime.queues) {
    const states = depth?.depths.get(queue);
    for (const state of QUEUE_DEPTH_STATES) {
      lines.push(
        `ftth_copilot_worker_queue_jobs{queue="${escapeLabel(queue)}",state="${escapeLabel(state)}"} ${states ? (states[state] ?? 0) : 0}`,
      );
    }
  }
  lines.push('');

  // Whether the depth could be read. A queue that could not be counted is
  // reported as zero depth, and this gauge is what tells the operator that
  // the zero is "I do not know" and not "the queue is empty".
  lines.push(
    '# HELP ftth_copilot_worker_queue_depth_readable Whether the depth of a queue could be read from Redis (1=read, 0=unreadable).',
  );
  lines.push('# TYPE ftth_copilot_worker_queue_depth_readable gauge');
  for (const queue of runtime.queues) {
    const readable = depth ? depth.depths.has(queue) : false;
    lines.push(`ftth_copilot_worker_queue_depth_readable{queue="${escapeLabel(queue)}"} ${readable ? 1 : 0}`);
  }
  lines.push('');

  // The latency of the jobs, as a Prometheus histogram: VictoriaMetrics
  // turns the buckets into a quantile, so the operator can ask for the p95
  // of a queue without the worker keeping every sample in memory.
  const latency = runtime.latency;
  lines.push('# HELP ftth_copilot_worker_job_duration_seconds Time a job takes to run, per queue.');
  lines.push('# TYPE ftth_copilot_worker_job_duration_seconds histogram');
  for (const queue of runtime.queues) {
    const observed = latency?.get(queue);
    const buckets = observed?.buckets ?? [];
    for (let index = 0; index < DEFAULT_JOB_DURATION_BUCKETS_SECONDS.length; index += 1) {
      const boundary = DEFAULT_JOB_DURATION_BUCKETS_SECONDS[index]!;
      lines.push(
        `ftth_copilot_worker_job_duration_seconds_bucket{queue="${escapeLabel(queue)}",le="${boundary}"} ${buckets[index] ?? 0}`,
      );
    }
    // The +Inf bucket carries every observation, including the ones slower
    // than the last boundary.
    lines.push(
      `ftth_copilot_worker_job_duration_seconds_bucket{queue="${escapeLabel(queue)}",le="+Inf"} ${observed?.count ?? 0}`,
    );
    lines.push(
      `ftth_copilot_worker_job_duration_seconds_sum{queue="${escapeLabel(queue)}"} ${(observed?.sum ?? 0).toFixed(4)}`,
    );
    lines.push(
      `ftth_copilot_worker_job_duration_seconds_count{queue="${escapeLabel(queue)}"} ${observed?.count ?? 0}`,
    );
  }
  lines.push('');

  // The spool backlog is a gauge, not a counter: it is the number of events
  // received and not stored yet, and it goes down when the drain catches up.
  const ingest = runtime.ingest ?? EMPTY_INGEST_STATE;
  lines.push(
    '# HELP ftth_copilot_worker_ingest_spool_backlog Events received and not stored yet, waiting in the durable spool.',
  );
  lines.push('# TYPE ftth_copilot_worker_ingest_spool_backlog gauge');
  lines.push(`ftth_copilot_worker_ingest_spool_backlog ${ingest.backlog}`);
  lines.push('');

  // The dead-letter of the ingest path: the events that were moved aside
  // because they could not be stored. They are recoverable with
  // `pnpm replay:dead-letter`, and they are the first thing an operator
  // asks about when telemetry went missing.
  lines.push(
    '# HELP ftth_copilot_worker_ingest_dead_lettered_total Events moved to the dead-letter file because they could not be stored.',
  );
  lines.push('# TYPE ftth_copilot_worker_ingest_dead_lettered_total counter');
  lines.push(`ftth_copilot_worker_ingest_dead_lettered_total ${ingest.deadLettered}`);
  lines.push('');

  lines.push(
    '# HELP ftth_copilot_worker_ingest_dropped_total Events the spool refused because it reached its size limit.',
  );
  lines.push('# TYPE ftth_copilot_worker_ingest_dropped_total counter');
  lines.push(`ftth_copilot_worker_ingest_dropped_total ${ingest.dropped}`);
  lines.push('');

  lines.push(
    '# HELP ftth_copilot_worker_ingest_rate_limited_total Events discarded by the rate limit of the receiver.',
  );
  lines.push('# TYPE ftth_copilot_worker_ingest_rate_limited_total counter');
  lines.push(`ftth_copilot_worker_ingest_rate_limited_total ${ingest.rateLimited}`);
  lines.push('');

  return lines.join('\n') + '\n';
}

/**
 * Number of jobs of a queue that are not finished yet.
 *
 * A queue whose depth could not be read counts as zero, and the
 * `ftth_copilot_worker_queue_depth_readable` gauge says so: reporting a
 * depth of zero for a queue nobody could count would be a lie the operator
 * would read as "the queue is empty".
 */
function pendingDepth(depth: QueueDepthReport | undefined, queue: string): number {
  const states = depth?.depths.get(queue);
  if (!states) return 0;
  return (
    (states['waiting'] ?? 0) +
    (states['active'] ?? 0) +
    (states['delayed'] ?? 0) +
    (states['prioritized'] ?? 0) +
    (states['waiting-children'] ?? 0)
  );
}

/**
 * Creates the HTTP server. Not listening yet — use `startHealthServer` for
 * that, or `server.listen()` directly when the caller needs the handle.
 */
export function createHealthServer(runtime: WorkerRuntime, metricsToken?: string): Server {
  return createServer((req, res) => {
    void handleRequest(runtime, req, res, metricsToken).catch(() => {
      // The response may already be half-written; the only safe thing left
      // is to close it, so the scraper sees a failed request instead of a
      // request that never ends.
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': JSON_CONTENT_TYPE });
        res.end(JSON.stringify({ error: 'internal_error' }));
        return;
      }
      res.end();
    });
  });
}

/**
 * Starts the health server.
 *
 * Pass `port: 0` to bind an ephemeral port — the returned handle reports the
 * port that was actually bound, which is what tests use to avoid colliding
 * with a running instance.
 */
export async function startHealthServer(options: HealthServerOptions): Promise<HealthServerHandle> {
  const server = createHealthServer(options.runtime, options.metricsToken);
  const { port, host } = resolveHealthServerOptions(options);

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      reject(error);
    };
    server.once('error', onError);
    server.listen(port, host, () => {
      server.removeListener('error', onError);
      resolve();
    });
  });

  const address = server.address();
  const boundPort = typeof address === 'object' && address !== null ? address.port : port;

  return {
    server,
    port: boundPort,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
        // Keep-alive sockets would otherwise hold the close open.
        server.closeAllConnections();
      }),
  };
}

/** Routes one request. */
async function handleRequest(
  runtime: WorkerRuntime,
  req: IncomingMessage,
  res: ServerResponse,
  metricsToken?: string,
): Promise<void> {
  const method = req.method ?? 'GET';

  if (method !== 'GET' && method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': JSON_CONTENT_TYPE, Allow: 'GET, HEAD' });
    res.end(JSON.stringify({ error: 'method_not_allowed' }));
    return;
  }

  const path = (req.url ?? '/').split('?')[0];

  if (path === '/healthz') {
    const body = JSON.stringify(buildHealthPayload(runtime), null, 2);
    res.writeHead(200, { 'Content-Type': JSON_CONTENT_TYPE, 'Cache-Control': 'no-store' });
    res.end(method === 'HEAD' ? undefined : body);
    return;
  }

  if (path === '/metrics') {
    // The metrics endpoint carries the operational data of the fleet, so it
    // takes the same credential as the web's `/api/metrics`. The token is
    // optional: without it the endpoint is open, which is only safe while
    // the server stays on the loopback.
    if (metricsToken && !hasValidBearerToken(req, metricsToken)) {
      res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8', 'WWW-Authenticate': 'Bearer' });
      res.end('Unauthorized: missing or invalid bearer token\n');
      return;
    }

    const depth = await readQueueDepth(runtime);
    const body = renderPrometheusMetrics(runtime, Date.now(), depth);
    res.writeHead(200, { 'Content-Type': PROMETHEUS_CONTENT_TYPE, 'Cache-Control': 'no-store' });
    res.end(method === 'HEAD' ? undefined : body);
    return;
  }

  res.writeHead(404, { 'Content-Type': JSON_CONTENT_TYPE });
  res.end(JSON.stringify({ error: 'not_found' }));
}

/**
 * Reads the depth of the queues, with a bound.
 *
 * A read that hangs would hang the scrape, and the target would look down
 * when the worker is perfectly alive. The bound turns "Redis does not
 * answer" into "the depth could not be read", which the exposition reports
 * as such.
 */
async function readQueueDepth(runtime: WorkerRuntime): Promise<QueueDepthReport | undefined> {
  if (!runtime.queueDepth) return undefined;

  let timer: NodeJS.Timeout | undefined;
  const bound = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), QUEUE_DEPTH_TIMEOUT_MS);
    timer.unref();
  });

  try {
    return await Promise.race([runtime.queueDepth(), bound]);
  } catch {
    return undefined;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Whether the request carries the expected bearer token.
 *
 * The comparison is not constant-time: the token is a shared secret between
 * two processes of the same deployment, not a credential an attacker can
 * brute-force one request at a time.
 */
function hasValidBearerToken(req: IncomingMessage, expected: string): boolean {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return false;
  return header.slice('Bearer '.length).trim() === expected;
}

/** Seconds elapsed since the process started. */
function uptimeSeconds(runtime: WorkerRuntime, now: number): number {
  return Math.max(0, (now - runtime.startedAtMs) / 1000);
}

/** Counter of a queue, zeroed when the queue has none yet. */
function counterOf(runtime: WorkerRuntime, queue: string): QueueCounter {
  return runtime.counters.get(queue) ?? { completed: 0, failed: 0, retried: 0 };
}

/** Escapes a Prometheus label value. */
function escapeLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}
