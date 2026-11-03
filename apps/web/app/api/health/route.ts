import { NextResponse } from 'next/server';
import { workerOwnsBackgroundWork } from '@ftth-copilot/jobs';
import {
  overallHealthy,
  snapshotHealth,
  detectHangedLoops,
} from '@/lib/monitoring/scheduler-health';
import { readWorkerHealth } from '@/lib/monitoring/worker-health';
import {
  snapshotEvaluatedConnectionHealth,
} from '@/lib/monitoring/connection-health';
import { checkDatabaseHealth } from '@/lib/monitoring/database-health';
import { eventIngestStats } from '@/lib/monitoring/event-ingest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Health endpoint.
 *
 * Checks:
 *   1. Scheduled service loops (polling, firmware, fec, syslog).
 *   2. Per-connection health.
 *   3. PostgreSQL database connectivity.
 *
 * When either schedulers or database are unhealthy, the endpoint replies
 * with HTTP 503 so load balancers / orchestrators detect the degradation.
 *
 * **Who owns the loops.** In worker mode the loops run in the worker, and
 * this process does not run them at all. The state of the loops is then
 * read from the snapshot the worker publishes in Redis: the registry lives
 * in the memory of the worker, and this process cannot see it — it does not
 * even share the copy of the registry with the instrumentation that starts
 * the loops, because Next.js bundles each entry point separately.
 *
 * The endpoint says who owns the loops (`owner`), so an operator can tell
 * "there are no loops" from "the loops are in the worker and this is what
 * they are doing". A worker that publishes nothing is a worker that is not
 * working: the background work has no owner, and the endpoint says so.
 */
export async function GET(): Promise<NextResponse> {
  const workerOwns = workerOwnsBackgroundWork();
  const localServices = snapshotHealth();
  const workerSnapshot = workerOwns ? await readWorkerHealth() : null;
  const services = workerOwns ? (workerSnapshot?.services ?? {}) : localServices;

  const schedulersHealthy = overallHealthy(services);
  const now = Date.now();
  const hungLoops = detectHangedLoops(services, now);
  const connections = snapshotEvaluatedConnectionHealth(now);
  const database = await checkDatabaseHealth();

  const isDatabaseHealthy = database.status === 'connected';
  const healthy = schedulersHealthy && isDatabaseHealthy;
  const localIngest = eventIngestStats();
  // In worker mode this process ingests nothing: its counters are always
  // zero. The backlog and the losses that matter are the ones of the
  // worker, which owns the durable spool.
  const ingest = { ...localIngest, ...(workerSnapshot?.counters ?? {}) };

  // Telemetry loss has to be loud. A backlog means the database was
  // unreachable and events are waiting on disk; drops mean events are gone.
  // Neither should hide behind an otherwise green status.
  const ingestLossy = ingest.dropped > 0 || ingest.rateLimited > 0;
  // A worker that publishes nothing is not publishing because it is not
  // working. The background work would have no owner at all.
  const workerMissing = workerOwns && workerSnapshot === null;
  // `overallHealthy` is the imported scheduler helper, so this stays distinct.
  const statusHealthy = healthy && !ingestLossy && !workerMissing;

  return NextResponse.json(
    {
      status: statusHealthy ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: {
        rss: Math.round(process.memoryUsage().rss / 1024 / 1024),
        heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      },
      version: process.env['npm_package_version'] ?? '0.5.0',
      database,
      owner: workerOwns ? 'worker' : 'embedded',
      services,
      hungLoops,
      connections,
      ingest,
    },
    { status: statusHealthy ? 200 : 503 },
  );
}
