import { NextRequest } from 'next/server';
import { prisma } from '@ftth-copilot/db';
import { getCurrentUser } from '@/lib/auth/server';
import { hasPermission } from '@/lib/auth/permissions';
import { detectAnomalies, groupAnomalies, medianAbsoluteDeviation } from '@ftth-copilot/analytics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VM_URL = process.env['VICTORIAMETRICS_URL'] ?? 'http://localhost:8428';
const VM_TOKEN = process.env['VICTORIAMETRICS_TOKEN'] ?? '';

/**
 * Metrics worth watching for anomalous behaviour, with the sampling period that
 * matches each range query. `pointsPerDay` must equal the actual step so the seasonal
 * profile is built over real daily cycles rather than an assumed one.
 */
const WATCHLIST = [
  { key: 'llm_latency', expr: 'avg(ftth_llm_latency_seconds:avg15m)', stepSeconds: 900, pointsPerDay: 96 },
  { key: 'memory_rss', expr: 'ftth_copilot_process_memory_bytes{type="rss"}', stepSeconds: 300, pointsPerDay: 288 },
  { key: 'llm_tokens_rate', expr: 'sum(rate(ftth_copilot_llm_tokens_total[5m]))', stepSeconds: 300, pointsPerDay: 288 },
  { key: 'router_dispatch_rate', expr: 'sum(rate(ftth_copilot_router_dispatches_total[5m]))', stepSeconds: 300, pointsPerDay: 288 },
  { key: 'active_alerts', expr: 'sum(ftth_ops_active:alerts)', stepSeconds: 300, pointsPerDay: 288 },
] as const;

export interface AnomalyReport {
  key: string;
  expr: string;
  points: number;
  /** Robust dispersion of the residual; the unit the z-scores are expressed in. */
  residualMad: number;
  groups: Array<{
    startIndex: number;
    endIndex: number;
    length: number;
    direction: 'up' | 'down';
    peakScore: number;
    peakIndex: number;
    inCommunity: boolean;
    peakValue: number;
    /** Minutes before now at which the group ended, for display. */
    ageMinutes: number;
  }>;
}

interface RangeResult {
  status: string;
  data: {
    resultType: string;
    result: Array<{ values: Array<[number, string]> }>;
  };
}

async function rangeQuery(expr: string, stepSeconds: number, lookbackHours: number): Promise<Array<[number, string]>> {
  const end = Math.floor(Date.now() / 1000);
  const start = end - lookbackHours * 3600;
  const url =
    `${VM_URL}/api/v1/query_range?query=${encodeURIComponent(expr)}` +
    `&start=${start}&end=${end}&step=${stepSeconds}`;
  const res = await fetch(url, {
    headers: VM_TOKEN ? { Authorization: `Bearer ${VM_TOKEN}` } : {},
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) return [];
  const json = (await res.json()) as RangeResult;
  return json?.data?.result?.[0]?.values ?? [];
}

/**
 * GET /api/ops/anomalies?hours=168
 *
 * Runs the RBCD detector over the watchlist metrics and returns contiguous anomaly
 * groups, newest first. Requires `view_network`.
 */
export async function GET(req: NextRequest): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 });
  if (!hasPermission(user.role, 'view_network')) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const hoursParam = Number(req.nextUrl.searchParams.get('hours') ?? 168);
  const hours = Math.min(Math.max(Number.isFinite(hoursParam) ? hoursParam : 168, 24), 720);

  const reports: AnomalyReport[] = [];

  await Promise.all(
    WATCHLIST.map(async (metric) => {
      try {
        const values = await rangeQuery(metric.expr, metric.stepSeconds, hours);
        if (values.length < 48) return; // too short to establish a seasonal profile

        const series = values.map(([, v]) => parseFloat(v) || 0);
        const anomalies = detectAnomalies(series, {
          pointsPerDay: metric.pointsPerDay,
          zThreshold: 4,
          minCommunityLength: 2,
        });
        if (anomalies.length === 0) return;

        const endSeconds = values[values.length - 1]![0];
        const stepSeconds = metric.stepSeconds;

        reports.push({
          key: metric.key,
          expr: metric.expr,
          points: series.length,
          residualMad: medianAbsoluteDeviation(series),
          groups: groupAnomalies(anomalies)
            .map((g) => ({
              startIndex: g.startIndex,
              endIndex: g.endIndex,
              length: g.length,
              direction: g.direction,
              peakScore: Number(g.peakScore.toFixed(2)),
              peakIndex: g.peakIndex,
              inCommunity: g.points.some((p) => p.inCommunity),
              peakValue: g.points[g.peakIndex - g.startIndex]?.value ?? 0,
              ageMinutes: Math.round(((endSeconds - values[g.endIndex]![0]) / 60)),
              stepSeconds,
            }))
            .sort((a, b) => a.ageMinutes - b.ageMinutes),
        });
      } catch {
        // A single unreachable metric must not fail the whole watchlist.
      }
    }),
  );

  // Newest group across all metrics first.
  reports.sort((a, b) => (a.groups[0]?.ageMinutes ?? 1e9) - (b.groups[0]?.ageMinutes ?? 1e9));

  return Response.json({
    hours,
    metricsScanned: WATCHLIST.length,
    count: reports.length,
    reports,
    generatedAt: new Date().toISOString(),
  });
}
