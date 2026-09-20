import { NextResponse } from 'next/server';
import {
  overallHealthy,
  snapshotHealth,
  detectHangedLoops,
} from '@/lib/monitoring/scheduler-health';
import {
  snapshotEvaluatedConnectionHealth,
} from '@/lib/monitoring/connection-health';
import { checkDatabaseHealth } from '@/lib/monitoring/database-health';

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
 */
export async function GET(): Promise<NextResponse> {
  const services = snapshotHealth();
  const schedulersHealthy = overallHealthy(services);
  const now = Date.now();
  const hungLoops = detectHangedLoops(services, now);
  const connections = snapshotEvaluatedConnectionHealth(now);
  const database = await checkDatabaseHealth();

  const isDatabaseHealthy = database.status === 'connected';
  const healthy = schedulersHealthy && isDatabaseHealthy;

  return NextResponse.json(
    {
      status: healthy ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: {
        rss: Math.round(process.memoryUsage().rss / 1024 / 1024),
        heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      },
      version: process.env['npm_package_version'] ?? '0.2.1',
      database,
      services,
      hungLoops,
      connections,
    },
    { status: healthy ? 200 : 503 },
  );
}
