import { NextRequest } from 'next/server';
import { prisma } from '@ftth-copilot/db';
import { getCurrentUser } from '@/lib/auth/server';
import { hasPermission } from '@/lib/auth/permissions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VM_URL = process.env['VICTORIAMETRICS_URL'] ?? 'http://localhost:8428';
const VM_TOKEN = process.env['VICTORIAMETRICS_TOKEN'] ?? '';

interface StreamEvent {
  type: 'heartbeat' | 'alert' | 'incident' | 'metric' | 'situation';
  timestamp: string;
  data: Record<string, unknown>;
}

/**
 * GET /api/ops/stream
 *
 * Server-Sent Events stream for real-time NOC updates.
 * Pushes:
 *   - heartbeat every 10s
 *   - active alert/incident changes every 15s
 *   - VM metric snapshots every 30s
 *
 * Requires authentication cookie.
 * Clients should reconnect on disconnect.
 */
export async function GET(req: NextRequest): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) {
    return new Response('Unauthorized', { status: 401 });
  }
  if (!hasPermission(user.role, 'view_network')) {
    return new Response('Forbidden', { status: 403 });
  }

  const tenantId = user.tenantId;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      // Send initial snapshot immediately
      await sendSnapshot(controller, encoder, tenantId);

      let tick = 0;
      const interval = setInterval(async () => {
        try {
          tick++;

          if (tick % 3 === 0) {
            // Every ~30s: full snapshot
            await sendSnapshot(controller, encoder, tenantId);
          } else {
            // Incremental: just alert/incident delta
            await sendDelta(controller, encoder, tenantId);
          }

          // Heartbeat every tick
          controller.enqueue(
            encoder.encode(`event: heartbeat\ndata: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`),
          );
        } catch {
          // On error, send heartbeat to keep connection alive
          controller.enqueue(
            encoder.encode(`event: heartbeat\ndata: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`),
          );
        }
      }, 10_000);

      req.signal.addEventListener('abort', () => {
        clearInterval(interval);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    },
  });
}

async function sendSnapshot(controller: ReadableStreamDefaultController, encoder: TextEncoder, tenantId: string) {
  const [alerts, incidents, vmMetrics] = await Promise.all([
    prisma.detectedAlert.findMany({
      where: { tenantId, status: { in: ['open', 'acknowledged'] } },
      select: { id: true, deviceKind: true, deviceId: true, severity: true, title: true, lastSeenAt: true, kind: true },
    }),
    prisma.incident.findMany({
      where: { tenantId, status: { in: ['open', 'acknowledged'] } },
      select: { id: true, deviceKind: true, deviceId: true, severity: true, title: true, lastSeenAt: true },
    }),
    fetchVMMetrics(),
  ]);

  // NOTE: vmMetrics is spread first so its scalar counters (notably `incidents`,
  // a number) cannot shadow the `activeIncidents` / `activeAlerts` arrays below.
  // The previous ordering let `...vmMetrics.incidents` overwrite the incident array.
  const event: StreamEvent = {
    type: 'heartbeat',
    timestamp: new Date().toISOString(),
    data: {
      ...vmMetrics,
      activeAlerts: alerts.map(a => ({ ...a, lastSeenAt: a.lastSeenAt.toISOString() })),
      activeIncidents: incidents.map(i => ({ ...i, lastSeenAt: i.lastSeenAt.toISOString() })),
    },
  };

  controller.enqueue(encoder.encode(`event: snapshot\ndata: ${JSON.stringify(event)}\n\n`));
}

async function sendDelta(controller: ReadableStreamDefaultController, encoder: TextEncoder, tenantId: string) {
  const since = new Date(Date.now() - 60_000); // last minute

  const [alerts, incidents] = await Promise.all([
    prisma.detectedAlert.findMany({
      where: { tenantId, lastSeenAt: { gte: since } },
      select: { id: true, deviceKind: true, deviceId: true, severity: true, title: true, lastSeenAt: true, kind: true, status: true },
    }),
    prisma.incident.findMany({
      where: { tenantId, lastSeenAt: { gte: since } },
      select: { id: true, deviceKind: true, deviceId: true, severity: true, title: true, lastSeenAt: true, status: true },
    }),
  ]);

  if (alerts.length === 0 && incidents.length === 0) return;

  const event: StreamEvent = {
    type: 'incident',
    timestamp: new Date().toISOString(),
    data: {
      alerts: alerts.map(a => ({ ...a, lastSeenAt: a.lastSeenAt.toISOString() })),
      incidents: incidents.map(i => ({ ...i, lastSeenAt: i.lastSeenAt.toISOString() })),
    },
  };

  controller.enqueue(encoder.encode(`event: delta\ndata: ${JSON.stringify(event)}\n\n`));
}

async function fetchVMMetrics(): Promise<Record<string, unknown>> {
  try {
    const instant = async (q: string): Promise<number> => {
      const url = `${VM_URL}/api/v1/query?query=${encodeURIComponent(q)}`;
      const res = await fetch(url, {
        headers: VM_TOKEN ? { Authorization: `Bearer ${VM_TOKEN}` } : {},
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return 0;
      const d = await res.json();
      // An instant query returns `value: [ts, "val"]` per series. `values` only exists
      // on a range query, so reading `values` here silently threw and dropped every
      // metric from the stream payload.
      const series = d?.data?.result?.[0];
      const raw = series?.value?.[1] ?? series?.values?.[0]?.[1];
      return raw === undefined ? 0 : parseFloat(raw) || 0;
    };

    const [up, crit, warn, inc, memRss, uptime] = await Promise.all([
      instant('up{job="ftth-copilot-app"}'),
      instant('sum(ftth_ops_active:alerts{severity="critical"})'),
      instant('sum(ftth_ops_active:alerts{severity="warning"})'),
      instant('sum(ftth_ops_active:incidents)'),
      instant('ftth_copilot_process_memory_bytes{type="rss"}'),
      instant('ftth_copilot_process_uptime_seconds'),
    ]);

    const score = (up > 0 ? 35 : 0) + Math.max(0, 35 - crit * 12) + Math.max(0, 15 - warn * 3) + Math.max(0, 15 - inc * 3);

    return { healthScore: score, up: up > 0, criticalAlerts: crit, warningAlerts: warn, incidents: inc, memRss, uptime };
  } catch {
    return {};
  }
}
