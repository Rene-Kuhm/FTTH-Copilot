import { NextResponse } from 'next/server';
import {
  overallHealthy,
  snapshotHealth,
  detectHangedLoops,
} from '@/lib/monitoring/scheduler-health';
import {
  snapshotEvaluatedConnectionHealth,
} from '@/lib/monitoring/connection-health';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Health endpoint.
 *
 * The previous implementation only returned process metrics
 * (`uptime`, memory, version) and a static `{ status: 'ok' }`. It did
 * not actually check that the scheduled loops were running. A syslog
 * socket that failed to bind (e.g. port already in use) would never
 * surface in the health response, so the NOC saw "ok" while
 * telemetry silently stopped.
 *
 * The new shape reports each scheduled service with its last-run
 * timestamp, last error, and expected/bound state, plus the
 * overall verdict. When `overallHealthy` returns false, the endpoint
 * replies with HTTP 503 so a simple liveness probe distinguishes
 * "process is alive" from "telemetry is flowing".
 *
 * `recentErrorMs` defaults to 5 minutes — a service that errored
 * six minutes ago is considered recovered.
 */
export async function GET(): Promise<NextResponse> {
  const services = snapshotHealth();
  const healthy = overallHealthy(services);
  const now = Date.now();
  const hungLoops = detectHangedLoops(services, now);
  const connections = snapshotEvaluatedConnectionHealth(now);

  return NextResponse.json(
    {
      status: healthy ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: {
        rss: Math.round(process.memoryUsage().rss / 1024 / 1024),
        heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      },
      version: process.env['npm_package_version'] ?? '0.1.0',
      services,
      hungLoops,
      connections,
    },
    { status: healthy ? 200 : 503 },
  );
}
