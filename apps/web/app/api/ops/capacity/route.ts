import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/server';
import { hasPermission } from '@/lib/auth/permissions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VM_URL = process.env['VICTORIAMETRICS_URL'] ?? 'http://localhost:8428';
const VM_TOKEN = process.env['VICTORIAMETRICS_TOKEN'] ?? '';

/**
 * Simple Exponential Smoothing (SES) — forecasts the next value from a time series.
 * Returns { forecast, trend, confidence, predictedOverloadAt }.
 */
function sesForecast(
  values: number[],
  alpha = 0.3,
  threshold?: number,
): { forecast: number; trend: number; confidence: number; predictedOverloadAt: number | null } {
  if (values.length === 0) return { forecast: 0, trend: 0, confidence: 0, predictedOverloadAt: null };
  if (values.length === 1) return { forecast: values[0]!, trend: 0, confidence: 0, predictedOverloadAt: null };

  // Double smoothing for trend
  let s = values[0]!, t = 0;
  for (const v of values) {
    const prev = s;
    s = alpha * v + (1 - alpha) * (s + t);
    t = 0.1 * (s - prev) + 0.9 * t; // β = 0.1 fixed
  }

  // Trend direction
  const trend = t;
  // Confidence: low when volatile
  const variance = values.reduce((s, v) => s + (v - (values.reduce((a, b) => a + b, 0) / values.length)) ** 2, 0) / values.length;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const cv = mean > 0 ? Math.sqrt(variance) / mean : 1;
  const confidence = Math.max(0, Math.min(1, 1 - cv));

  // Extrapolate: if trend > 0 and threshold given, estimate when value crosses threshold
  let predictedOverloadAt: number | null = null;
  if (threshold != null && trend > 0 && s < threshold) {
    const steps = Math.ceil((threshold - s) / trend);
    predictedOverloadAt = Date.now() + steps * 30_000; // 30s per step (scrape interval)
  } else if (threshold != null && s >= threshold) {
    predictedOverloadAt = Date.now(); // Already overloaded
  }

  return { forecast: s, trend, confidence, predictedOverloadAt };
}

interface CapacityDevice {
  deviceId: string;
  deviceKind: string;
  metric: string;
  current: number;
  unit: string;
  threshold: number;
  forecast: number;
  trend: number;
  confidence: number;
  predictedOverloadAt: number | null;
  projectedOverloadPct: number;
}

async function queryVM(query: string, range = 3600): Promise<Array<{ metric: Record<string, string>; values: [number, string][] }>> {
  const url = `${VM_URL}/api/v1/query_range?query=${encodeURIComponent(query)}&start=${Math.floor(Date.now() / 1000) - range}&end=${Math.floor(Date.now() / 1000)}&step=30s`;
  const res = await fetch(url, {
    headers: VM_TOKEN ? { Authorization: `Bearer ${VM_TOKEN}` } : {},
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.status === 'success' ? data.data.result : [];
}

/**
 * GET /api/ops/capacity
 *
 * Returns capacity forecasts for the application and NMS connections.
 * Uses Simple Exponential Smoothing on recent VM time-series data.
 *
 * Query params:
 *   hours=6   — lookback window (default 6h)
 *   min_conf=0.3 — minimum confidence to show prediction
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!hasPermission(user.role, 'view_network')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const url = new URL(req.url);
  const hours = Math.min(24, Math.max(1, Number.parseInt(url.searchParams.get('hours') ?? '6', 10)));
  const minConf = Math.max(0, Math.min(1, Number.parseFloat(url.searchParams.get('min_conf') ?? '0.3')));
  const rangeSec = hours * 3600;

  // ── 1. Application memory ───────────────────────────────────────
  const [memRss, memHeap] = await Promise.all([
    queryVM('ftth_copilot_process_memory_bytes{type="rss"}', rangeSec),
    queryVM('ftth_copilot_process_memory_bytes{type="heap_used"}', rangeSec),
  ]);

  const devices: CapacityDevice[] = [];

  for (const result of memRss) {
    const values = result.values.map(([, v]) => parseFloat(v) || 0);
    const { forecast, trend, confidence, predictedOverloadAt } = sesForecast(values, 0.3, 512 * 1_048_576);
    if (confidence < minConf) continue;
    const current = values[values.length - 1] ?? 0;
    devices.push({
      deviceId: result.metric.instance ?? 'app',
      deviceKind: 'APP',
      metric: 'RSS memory',
      current,
      unit: 'bytes',
      threshold: 512 * 1_048_576,
      forecast,
      trend,
      confidence,
      predictedOverloadAt,
      projectedOverloadPct: Math.round((forecast / (512 * 1_048_576)) * 100),
    } as unknown as CapacityDevice);
  }

  for (const result of memHeap) {
    const values = result.values.map(([, v]) => parseFloat(v) || 0);
    const { forecast, trend, confidence, predictedOverloadAt } = sesForecast(values, 0.3, 256 * 1_048_576);
    if (confidence < minConf) continue;
    const current = values[values.length - 1] ?? 0;
    const threshold = 256 * 1_048_576;
    devices.push({
      deviceId: result.metric.instance ?? 'app',
      deviceKind: 'APP',
      metric: 'Heap used',
      current,
      unit: 'bytes',
      threshold,
      forecast,
      trend,
      confidence,
      predictedOverloadAt,
      projectedOverloadPct: Math.round((forecast / threshold) * 100),
    });
  }

  // ── 2. LLM token rate ───────────────────────────────────────────
  const [tokenRate] = await Promise.all([queryVM('rate(ftth_copilot_llm_tokens_total[5m])', rangeSec)]);
  for (const result of tokenRate) {
    const values = result.values.map(([, v]) => parseFloat(v) || 0);
    const { forecast, trend, confidence, predictedOverloadAt } = sesForecast(values, 0.3);
    if (confidence < minConf) continue;
    const current = values[values.length - 1] ?? 0;
    devices.push({
      deviceId: result.metric.type ?? 'llm',
      deviceKind: 'LLM',
      metric: 'Token rate (5m avg)',
      current,
      unit: 'tokens/s',
      threshold: 100_000,
      forecast,
      trend,
      confidence,
      predictedOverloadAt,
      projectedOverloadPct: Math.round((forecast / 100_000) * 100),
    });
  }

  // ── 3. NMS connection status as proxy ─────────────────────────
  const [nmsConn] = await Promise.all([queryVM('ftth_copilot_nms_connections_total', rangeSec)]);
  for (const result of nmsConn) {
    const values = result.values.map(([, v]) => parseFloat(v) || 0);
    const { forecast, trend, confidence } = sesForecast(values, 0.2);
    if (confidence < minConf) continue;
    const current = values[values.length - 1] ?? 0;
    devices.push({
      deviceId: result.metric.provider ?? 'unknown',
      deviceKind: 'NMS',
      metric: 'Connections',
      current,
      unit: 'count',
      threshold: 50,
      forecast,
      trend,
      confidence,
      predictedOverloadAt: null,
      projectedOverloadPct: Math.round((current / 50) * 100),
    });
  }

  // Sort: highest projected overload first
  devices.sort((a, b) => b.projectedOverloadPct - a.projectedOverloadPct);

  const overloaded = devices.filter(d => d.projectedOverloadPct >= 90).length;
  const warning = devices.filter(d => d.projectedOverloadPct >= 70 && d.projectedOverloadPct < 90).length;

  return NextResponse.json({
    devices,
    summary: { total: devices.length, overloaded, warning, lookbackHours: hours },
  });
}
