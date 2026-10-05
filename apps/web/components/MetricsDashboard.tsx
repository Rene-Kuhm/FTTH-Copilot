'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth/client';
import { SituationsPanel } from './SituationsPanel';
import { NetworkTopologyMap } from './NetworkTopologyMap';
import { CapacityForecast } from './CapacityForecast';
import { ChangeTimeline } from './ChangeTimeline';
import { RunbookPanel } from './RunbookPanel';

// Captured once at module load — stable across re-renders, no impure-call-in-render issue.
const MODULE_LOAD_MS = Date.now();

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface TSPoint { timestamp: number; value: number }

interface Series {
  name: string;
  labels: Record<string, string>;
  points: TSPoint[];
  current: number;
  min: number;
  max: number;
  avg: number;
}

interface VMResponse {
  status: string;
  data: {
    resultType: string;
    result: Array<{ metric: Record<string, string>; values: [number, string][] }>;
  };
}

type TimeRange = '15m' | '1h' | '3h' | '6h';
const TR: Record<TimeRange, number> = { '15m': 900, '1h': 3600, '3h': 10800, '6h': 21600 };

// ── API types ────────────────────────────────────────────────────────────────
interface Prediction {
  id: string; kind: string; severity: string; deviceKind: string;
  deviceId: string; title: string; etaMs: number | null;
  confidence: number | null; status: string;
  firstSeenAt: string; lastSeenAt: string;
}
interface Incident {
  id: string; severity: string; status: string;
  firstSeenAt: string; lastSeenAt: string; alertCount: number;
}
interface SlaRow {
  connectionId: string | null; deviceKind: string; deviceId: string;
  uptimePercent: number | null; coveragePercent: number | null;
  offlineMs: number | null; measuredMs: number | null;
}
interface TopologyNode { kind: string; id: string; children: TopologyNode[]; downstreamCount: number; }

// ─────────────────────────────────────────────────────────────────────────────
// Parse helpers
// ─────────────────────────────────────────────────────────────────────────────

function parseVM(raw: VMResponse): Series[] {
  if (raw.status !== 'success') return [];
  return raw.data.result.map((r) => {
    const pts: TSPoint[] = r.values.map(([t, v]) => ({ timestamp: t, value: parseFloat(v) || 0 }));
    const vs = pts.map((p) => p.value);
    return {
      name: r.metric.__name__ ?? '?', labels: r.metric,
      points: pts,
      current: vs[vs.length - 1] ?? 0,
      min: vs.length ? Math.min(...vs) : 0,
      max: vs.length ? Math.max(...vs) : 0,
      avg: vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : 0,
    };
  });
}

const fmt = (n: number, d = 0) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M`
  : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k`
  : d > 0 ? n.toFixed(d)
  : Number.isInteger(n) ? n.toLocaleString('es-ES') : n.toFixed(2);

const fmtB = (b: number) =>
  b >= 1_073_741_824 ? `${(b / 1_073_741_824).toFixed(1)} GiB`
  : b >= 1_048_576 ? `${(b / 1_048_576).toFixed(0)} MiB`
  : b >= 1024 ? `${(b / 1024).toFixed(0)} KiB` : `${b} B`;

const fmtDur = (s: number) =>
  s >= 86400 ? `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`
  : s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
  : s >= 60 ? `${Math.floor(s / 60)}m`
  : `${Math.floor(s)}s`;

const fmtMs = (s: number) =>
  s < 0.001 ? `${(s * 1_000_000).toFixed(0)}µs`
  : s < 1 ? `${(s * 1000).toFixed(1)}ms`
  : `${s.toFixed(2)}s`;

// ─────────────────────────────────────────────────────────────────────────────
// Stream connection badge
// ─────────────────────────────────────────────────────────────────────────────

const STREAM_UI: Record<StreamStatus, { label: string; dot: string; text: string; pulse: boolean }> = {
  idle:        { label: 'inactivo',  dot: 'bg-base-content/30',      text: 'text-base-content/40', pulse: false },
  connecting:  { label: 'conectando', dot: 'bg-warning',            text: 'text-warning',        pulse: true },
  live:        { label: 'live',      dot: 'bg-success animate-pulse', text: 'text-success',      pulse: false },
  reconnecting:{ label: 'reconectando', dot: 'bg-warning animate-pulse', text: 'text-warning',    pulse: false },
  error:       { label: 'sin stream', dot: 'bg-error',              text: 'text-error',          pulse: false },
};

function StreamBadge({ status }: { status: StreamStatus }) {
  const ui = STREAM_UI[status];
  return (
    <span className={`ml-2 inline-flex items-center gap-1.5 ${ui.text}`} title={`SSE: ${status}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${ui.dot}`} />
      <span className="text-[11px] font-medium">{ui.label}</span>
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SSE Hook — named-event aware, with exponential backoff reconnect
// ─────────────────────────────────────────────────────────────────────────────

type StreamStatus = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'error';

/** Shape of the `data` field carried by the server's `snapshot` stream event. */
interface StreamSnapshot {
  healthScore?: number;
  up?: boolean;
  criticalAlerts?: number;
  warningAlerts?: number;
  incidents?: number;
  memRss?: number;
  uptime?: number;
  activeAlerts?: unknown[];
  activeIncidents?: unknown[];
}

interface SseHandlers {
  snapshot?: (payload: unknown) => void;
  delta?: (payload: unknown) => void;
  heartbeat?: (payload: unknown) => void;
}

/**
 * Opens an EventSource and routes the server's named events (`snapshot`, `delta`,
 * `heartbeat`) to their handlers. EventSource reconnects on its own, but it does so
 * eagerly and without backoff, so we close and re-open on a growing delay whenever a
 * connection errors, and reset the delay once a real payload arrives.
 *
 * The `event` name is not part of the SSE spec contract for a bare `onmessage`, so
 * `addEventListener` per known name is the only way to receive them.
 */
function useSSE(url: string | null, handlers: SseHandlers, enabled = true) {
  // Status is keyed by URL and derived during render, so a URL change can never leave a
  // stale "live" label behind, and no setState is needed inside the effect.
  const [live, setLive] = useState<{ url: string | null; status: StreamStatus }>({ url, status: 'idle' });
  const status: StreamStatus = live.url === url
    ? live.status
    : (url && enabled ? 'connecting' : 'idle');

  const handlersRef = useRef<SseHandlers>(handlers);
  // Synced in an effect (not during render) and declared before the connect effect, so
  // it is always populated by the time any message arrives.
  useEffect(() => { handlersRef.current = handlers; });

  useEffect(() => {
    if (!url || !enabled) return;

    let closed = false;
    let attempt = 0;
    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const publish = (s: StreamStatus) => setLive({ url, status: s });

    const connect = () => {
      if (closed) return;
      es = new EventSource(url);

      const onPayload = (kind: 'snapshot' | 'delta' | 'heartbeat') => (ev: MessageEvent) => {
        // A payload means the connection is healthy again — reset backoff.
        attempt = 0;
        publish('live');
        try {
          handlersRef.current[kind]?.(JSON.parse(ev.data));
        } catch {
          // A malformed frame must not tear down a working stream.
        }
      };

      es.addEventListener('snapshot', onPayload('snapshot'));
      es.addEventListener('delta', onPayload('delta'));
      es.addEventListener('heartbeat', onPayload('heartbeat'));

      es.onerror = () => {
        es?.close();
        es = null;
        if (closed) return;
        attempt += 1;
        publish(attempt > 5 ? 'error' : 'reconnecting');
        // 1s, 2s, 4s, 8s, 16s, capped at 30s.
        const delay = Math.min(1000 * 2 ** (attempt - 1), 30_000);
        retryTimer = setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      es?.close();
    };
  }, [url, enabled]);

  return { status };
}

// ─────────────────────────────────────────────────────────────────────────────
// SVG: Sparkline
// ─────────────────────────────────────────────────────────────────────────────

function Sparkline({ pts, color = '#3b82f6', h = 28 }: { pts: TSPoint[]; color?: string; h?: number }) {
  if (pts.length < 2) return <div className="h-7 w-16" />;
  const W = 120, vals = pts.map((p) => p.value);
  const lo = Math.min(...vals), hi = Math.max(...vals), rng = hi - lo || 1;
  const xs = pts.map((_, i) => (i / (pts.length - 1)) * W);
  const ys = pts.map((p) => h - ((p.value - lo) / rng) * (h - 4) - 2);
  const line = xs.map((x, i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ');
  const id = color.replace(/[^a-z]/gi, '');
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${W} ${h}`} preserveAspectRatio="none" className="overflow-visible">
      <defs>
        <linearGradient id={`sg-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={`M0,${h} ${line} L${W},${h} Z`} fill={`url(#sg-${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Health Ring
// ─────────────────────────────────────────────────────────────────────────────

function HealthRing({ score }: { score: number }) {
  const r = 36, circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  const col = score >= 85 ? '#10b981' : score >= 60 ? '#f59e0b' : score > 0 ? '#ef4444' : '#6b7280';
  const label = score >= 85 ? 'Operational' : score >= 60 ? 'Degraded' : score > 0 ? 'Critical' : 'Unknown';
  return (
    <svg width="90" height="90" viewBox="0 0 90 90">
      <circle cx="45" cy="45" r={r} fill="none" stroke="var(--color-base-300)" strokeWidth="8" />
      <circle cx="45" cy="45" r={r} fill="none" stroke={col} strokeWidth="8"
        strokeLinecap="round" strokeDasharray={`${dash} ${circ}`}
        strokeDashoffset={circ * 0.25} transform="rotate(-90 45 45)"
        style={{ transition: 'stroke-dasharray 0.8s ease' }} />
      <text x="45" y="40" textAnchor="middle" dominantBaseline="middle"
        className="fill-base-content font-mono text-xl font-black">{Math.round(score)}</text>
      <text x="45" y="55" textAnchor="middle" dominantBaseline="middle"
        className="fill-base-content/40" style={{ fontSize: '9px' }}>{label}</text>
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// KPI Tile
// ─────────────────────────────────────────────────────────────────────────────

function KpiTile({ label, value, unit, spark, trend, color = 'inherit' }: {
  label: string; value: string | number; unit?: string;
  spark?: TSPoint[]; trend?: number; color?: string;
}) {
  const tc = trend === undefined ? '' : trend > 0 ? 'text-error' : trend < 0 ? 'text-success' : 'text-base-content/40';
  return (
    <div className="flex flex-1 flex-col gap-2 rounded-xl border border-base-200 bg-base-100 p-4">
      <span className="text-[10px] font-medium uppercase tracking-widest text-base-content/40">{label}</span>
      <div className="flex items-end justify-between gap-2">
        <div className="flex items-baseline gap-1">
          <span className="font-mono text-2xl font-black" style={{ color }}>{value}</span>
          {unit && <span className="text-xs text-base-content/40">{unit}</span>}
        </div>
        {spark && spark.length >= 2 && <div className="w-14 shrink-0"><Sparkline pts={spark} color={color} h={24} /></div>}
      </div>
      {trend !== undefined && (
        <span className={`text-xs font-mono ${tc}`}>{trend >= 0 ? '↑' : '↓'} {Math.abs(trend).toFixed(1)}% período</span>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Golden Signal: Latency bar
// ─────────────────────────────────────────────────────────────────────────────

function GoldenLatency({ series }: {
  series: Array<{ provider: string; p50: number; p95: number; p99: number; pts: TSPoint[] }>;
}) {
  if (!series.length) return (
    <span className="text-xs text-base-content/30">Sin datos de latencia LLM</span>
  );
  return (
    <div className="space-y-2.5">
      {series.map((s) => {
        const col = s.p99 >= 2 ? '#ef4444' : s.p99 >= 1 ? '#f59e0b' : '#10b981';
        const p99pct = Math.min((s.p99 / 3) * 100, 100);
        const p95pct = Math.min((s.p95 / 3) * 100, 100);
        const p50pct = Math.min((s.p50 / 3) * 100, 100);
        return (
          <div key={s.provider} className="flex items-center gap-3">
            <span className="w-20 truncate text-xs text-base-content/50 font-medium">{s.provider}</span>
            <div className="flex flex-1 flex-col gap-1">
              <div className="relative h-2 overflow-hidden rounded-full bg-base-200">
                <div className="absolute left-0 h-full rounded-full opacity-20" style={{ width: `${p99pct}%`, backgroundColor: col }} />
                <div className="absolute left-0 h-full rounded-full opacity-40" style={{ width: `${p95pct}%`, backgroundColor: col }} />
                <div className="h-full rounded-full" style={{ width: `${p50pct}%`, backgroundColor: col }} />
              </div>
              <div className="flex gap-3 text-[9px] text-base-content/40">
                <span>p50 <span className="font-mono">{fmtMs(s.p50)}</span></span>
                <span>p95 <span className="font-mono">{fmtMs(s.p95)}</span></span>
                <span>p99 <span className="font-mono">{fmtMs(s.p99)}</span></span>
              </div>
            </div>
            {s.pts.length >= 2 && <div className="w-12 shrink-0"><Sparkline pts={s.pts.map(p => ({ ...p, value: p.value * 1000 }))} color={col} h={20} /></div>}
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Golden Signal: Saturation
// ─────────────────────────────────────────────────────────────────────────────

function SatBar({ label, current, limit, color = '#3b82f6' }: {
  label: string; current: number; limit: number; color?: string;
}) {
  const pct = limit > 0 ? Math.min((current / limit) * 100, 100) : 0;
  const col = pct >= 90 ? '#ef4444' : pct >= 70 ? '#f59e0b' : color;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-base-content/60">{label}</span>
        <span className="font-mono font-medium" style={{ color: col }}>{pct.toFixed(1)}%</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-base-200">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: col }} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Dispatch donut
// ─────────────────────────────────────────────────────────────────────────────

const MODE_COL: Record<string, string> = { direct: '#10b981', assisted: '#3b82f6', investigation: '#f59e0b', unknown: '#6b7280' };

function DispatchDonut({ dispatches }: { dispatches: Series[] }) {
  const total = dispatches.reduce((s, d) => s + d.current, 0);
  if (!total) return null;
  const slices = dispatches.reduce<Array<{ pct: number; start: number; end: number } & Series>>((acc, d) => {
    const pct = (d.current / total) * 100;
    const start = acc.length ? acc[acc.length - 1].end : 0;
    acc.push({ ...d, pct, start, end: start + pct });
    return acc;
  }, []);
  const r = 26, circ = 2 * Math.PI * r;
  return (
    <div className="flex items-center gap-3">
      <svg width="64" height="64" viewBox="0 0 64 64">
        {slices.map((s, i) => {
          const sa = (s.start / 100) * circ - circ / 4;
          const ea = (s.end / 100) * circ - circ / 4;
          const large = s.pct > 50 ? 1 : 0;
          const x1 = (r + r * Math.cos(sa)).toFixed(2), y1 = (r + r * Math.sin(sa)).toFixed(2);
          const x2 = (r + r * Math.cos(ea)).toFixed(2), y2 = (r + r * Math.sin(ea)).toFixed(2);
          return <path key={i} d={`M${r},${r} L${x1},${y1} A${r},${r} 0 ${large},1 ${x2},${y2} Z`}
            fill={MODE_COL[s.labels.mode ?? 'unknown']} />;
        })}
        <circle cx={r} cy={r} r={r * 0.55} fill="var(--color-base-100)" />
        <text x={r} y={r - 2} textAnchor="middle" dominantBaseline="middle"
          className="fill-base-content font-mono text-xs font-bold">{fmt(total)}</text>
        <text x={r} y={r + 9} textAnchor="middle" dominantBaseline="middle"
          className="fill-base-content/40" style={{ fontSize: '7px' }}>total</text>
      </svg>
      <div className="flex flex-col gap-1">
        {slices.map((s) => (
          <div key={s.labels.mode} className="flex items-center gap-1.5">
            <div className="h-2 w-3 rounded-sm" style={{ backgroundColor: MODE_COL[s.labels.mode ?? 'unknown'] }} />
            <span className="text-[10px] capitalize text-base-content/70">{s.labels.mode ?? 'unknown'}</span>
            <span className="font-mono text-[10px] font-semibold">{s.pct.toFixed(0)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SLA Table
// ─────────────────────────────────────────────────────────────────────────────

function SlaTable({ rows }: { rows: SlaRow[] }) {
  if (!rows.length) return <span className="text-xs text-base-content/30">Sin datos de SLA</span>;
  return (
    <div className="space-y-1.5 max-h-40 overflow-y-auto">
      {rows.slice(0, 8).map((r, i) => {
        const up = r.uptimePercent ?? 0;
        const col = up >= 99.5 ? '#10b981' : up >= 98 ? '#f59e0b' : '#ef4444';
        const cov = r.coveragePercent ?? 0;
        return (
          <div key={i} className="flex items-center gap-2 rounded-md bg-base-200/30 px-2 py-1.5">
            <span className="w-16 truncate text-[10px] text-base-content/60 font-medium">{r.deviceKind}</span>
            <span className="w-20 truncate text-[10px] text-base-content/40 font-mono">{r.deviceId}</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-base-200">
              <div className="h-full rounded-full" style={{ width: `${up}%`, backgroundColor: col }} />
            </div>
            <span className="w-12 text-right font-mono text-xs font-bold" style={{ color: col }}>
              {up >= 100 ? '100%' : `${up.toFixed(2)}%`}
            </span>
            <span className="w-10 text-right font-mono text-[9px] text-base-content/40">{cov.toFixed(0)}% cov</span>
          </div>
        );
      })}
      {rows.length > 8 && <div className="text-center text-[9px] text-base-content/30 py-1">+{rows.length - 8} más</div>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Predictions panel (AIOps proactive)
// ─────────────────────────────────────────────────────────────────────────────

function PredictionsPanel({ predictions }: { predictions: Prediction[] }) {
  if (!predictions.length) return (
    <div className="flex items-center gap-2 py-3 text-xs text-success">
      <span className="h-2 w-2 rounded-full bg-success" />
      Sin predicciones activas
    </div>
  );
  const bySev = {
    critical: predictions.filter(p => p.severity === 'critical').length,
    warning: predictions.filter(p => p.severity === 'warning').length,
    info: predictions.filter(p => p.severity === 'info').length,
  };
  return (
    <div className="space-y-2">
      <div className="flex gap-3 text-xs">
        {bySev.critical > 0 && <span className="text-error font-bold">⚠ {bySev.critical} críticas</span>}
        {bySev.warning > 0 && <span className="text-warning font-bold">⚡ {bySev.warning} warnings</span>}
        {bySev.info > 0 && <span className="text-base-content/50">{bySev.info} info</span>}
      </div>
      <div className="space-y-1 max-h-36 overflow-y-auto">
        {predictions.slice(0, 6).map((p) => {
          const sev = p.severity === 'critical' ? '#ef4444' : p.severity === 'warning' ? '#f59e0b' : '#6b7280';
          const eta = p.etaMs ? fmtDur(p.etaMs / 1000) : '?';
          const conf = p.confidence ? `${(p.confidence * 100).toFixed(0)}%` : '?';
          return (
            <div key={p.id} className="flex items-start gap-2 rounded-md px-2 py-1.5"
              style={{ borderLeft: `3px solid ${sev}`, background: 'var(--color-base-200/30)' }}>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[10px] font-medium" style={{ color: sev }}>{p.title}</div>
                <div className="text-[9px] text-base-content/40">{p.deviceKind} · {p.deviceId}</div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-[10px] font-mono font-bold" style={{ color: sev }}>~{eta}</div>
                <div className="text-[9px] text-base-content/40">conf {conf}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Incidents + MTTR panel
// ─────────────────────────────────────────────────────────────────────────────

function IncidentsPanel({ incidents, now }: { incidents: Incident[]; now: number }) {
  const open = incidents.filter(i => i.status === 'open' || i.status === 'acknowledged');
  const resolved = incidents.filter(i => i.status === 'resolved');

  // MTTR: for resolved incidents, avg time from firstSeen to lastSeen
  const mttrMs = resolved.length
    ? resolved.reduce((s, i) => s + (new Date(i.lastSeenAt).getTime() - new Date(i.firstSeenAt).getTime()), 0) / resolved.length
    : 0;

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
        <div className={`rounded-lg border p-3 text-center ${open.length ? 'border-error/40 bg-error/5' : 'border-base-200'}`}>
          <div className={`font-mono text-xl font-black ${open.length ? 'text-error' : 'text-base-content/20'}`}>{open.length}</div>
          <div className="text-[9px] text-base-content/40">Abiertos</div>
        </div>
        <div className="rounded-lg border border-base-200 p-3 text-center">
          <div className="font-mono text-xl font-black text-warning">{resolved.length}</div>
          <div className="text-[9px] text-base-content/40">Resueltos</div>
        </div>
        <div className="rounded-lg border border-base-200 p-3 text-center">
          <div className="font-mono text-xl font-black text-base-content">{fmtDur(mttrMs / 1000)}</div>
          <div className="text-[9px] text-base-content/40">MTTR avg</div>
        </div>
      </div>
      {open.slice(0, 4).map((inc) => {
        const sev = inc.severity === 'critical' ? '#ef4444' : '#f59e0b';
        const ageMs = now - new Date(inc.firstSeenAt).getTime();
        return (
          <div key={inc.id} className="flex items-center gap-2 rounded-md px-2 py-1.5"
            style={{ borderLeft: `3px solid ${sev}`, background: 'var(--color-base-200/30)' }}>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[10px] font-medium" style={{ color: sev }}>{inc.severity.toUpperCase()}</div>
              <div className="text-[9px] text-base-content/40">Hace {fmtDur(ageMs / 1000)}</div>
            </div>
            <span className="badge badge-xs" style={{ backgroundColor: sev + '20', color: sev }}>{inc.status}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Topology mini-tree (OLT → PON ports → ONUs)
// ─────────────────────────────────────────────────────────────────────────────

function TopologyTree({ roots }: { roots: TopologyNode[] }) {
  if (!roots.length) return null;
  function render(node: TopologyNode, depth = 0): React.ReactNode {
    const icon = node.kind === 'OLT' ? '🔵' : node.kind === 'PON_PORT' ? '⚪' : node.kind === 'SPLITTER' ? '◐' : node.kind === 'CTO' ? '🔶' : node.kind === 'ONU' ? '🔴' : '◽';
    return (
      <div key={`${node.kind}-${node.id}`} style={{ marginLeft: depth * 12 }}>
        <div className="flex items-center gap-1 py-0.5">
          <span className="text-[10px]">{icon}</span>
          <span className="text-[10px] font-medium text-base-content/70">{node.kind}</span>
          <span className="text-[10px] font-mono text-base-content/50 truncate max-w-20">{node.id}</span>
          {node.downstreamCount > 0 && (
            <span className="badge badge-xs badge-outline">{node.downstreamCount}</span>
          )}
        </div>
        {node.children?.map(child => render(child, depth + 1))}
      </div>
    );
  }
  return (
    <div className="max-h-52 overflow-y-auto space-y-1">
      {roots.map(root => render(root, 0))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Recording rules reference
// ─────────────────────────────────────────────────────────────────────────────

function RulesRef() {
  const rules = [
    ['ftth_router_dispatch_ratio:mode15m', 'Share de cada modo de router en 15m'],
    ['ftth_router_dispatches:rate1h', 'Dispatches por hora (cualquier modo)'],
    ['ftth_llm_requests:rate5m', 'Rate de requests LLM por provider (5m)'],
    ['ftth_llm_latency_seconds:avg15m', 'Latencia promedio LLM por provider (15m)'],
    ['ftth_llm_fallback:rate15m', 'Fallbacks de provider (15m)'],
    ['ftth_snmp_traps:rate15m', 'Rate de traps por status (15m)'],
    ['ftth_ops_active:alerts', 'Alertas activas por severidad'],
    ['ftth_ops_active:incidents', 'Incidentes activos totales'],
  ];
  return (
    <details className="rounded-xl border border-base-200">
      <summary className="cursor-pointer px-4 py-2.5 text-xs font-medium text-base-content/40 hover:bg-base-200/30">
        Recording rules disponibles en VictoriaMetrics
      </summary>
      <div className="divide-y divide-base-200 px-4 pb-3">
        {rules.map(([name, desc]) => (
          <div key={name} className="flex items-start gap-3 py-2">
            <code className="shrink-0 font-mono text-[9px] text-primary">{name}</code>
            <span className="text-[10px] text-base-content/40">{desc}</span>
          </div>
        ))}
      </div>
    </details>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main dashboard
// ─────────────────────────────────────────────────────────────────────────────

export default function MetricsDashboard() {
  const auth = useAuth();
  const [tr, setTr] = useState<TimeRange>('15m');
  const [loading, setLoading] = useState(false);
  const [updated, setUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  // VM state
  const [healthScore, setHealthScore] = useState(0);
  const [up, setUp] = useState(false);
  const [criticalAlerts, setCriticalAlerts] = useState(0);
  const [warningAlerts, setWarningAlerts] = useState(0);
  const [incidents, setIncidents] = useState(0);
  const [llmLatency, setLlmLatency] = useState<Array<{ provider: string; p50: number; p95: number; p99: number; pts: TSPoint[] }>>([]);
  const [requestsRate, setRequestsRate] = useState<{ total: number; pts: TSPoint[] }>({ total: 0, pts: [] });
  const [memRss, setMemRss] = useState(0);
  const [memHeap, setMemHeap] = useState(0);
  const [memRssPts, setMemRssPts] = useState<TSPoint[]>([]);
  const [dispatches, setDispatches] = useState<Series[]>([]);
  const [snmpTraps, setSnmpTraps] = useState<Series[]>([]);
  const [nmsConn, setNmsConn] = useState<Array<{ provider: string; up: boolean; count: number }>>([]);
  const [uptime, setUptime] = useState(0);
  const [samples, setSamples] = useState(0);
  const [llmFallback, setLlmFallback] = useState(0);
  const [llmTokens, setLlmTokens] = useState(0);
  const [fbBreakdown, setFbBreakdown] = useState<Array<{ provider: string; rate: number; pts: TSPoint[] }>>([]);
  const [tokBreakdown, setTokBreakdown] = useState<Series[]>([]);

  // API state (from /api/* routes)
  const [slaRows, setSlaRows] = useState<SlaRow[]>([]);
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [apiIncidents, setApiIncidents] = useState<Incident[]>([]);
  const [topologyRoots, setTopologyRoots] = useState<TopologyNode[]>([]);

  // SSE streaming: first poll, then SSE for live updates
  const [lastPoll, setLastPoll] = useState(0);
  const rng = TR[tr];
  const tenantId = auth.user?.tenantId;

  // ── VM query helpers ─────────────────────────────────────────────────
  const query = useCallback(async (q: string): Promise<Series[]> => {
    const r = await fetch(`/api/vm/query?query=${encodeURIComponent(q)}&range=${rng}`);
    if (!r.ok) return [];
    return parseVM(await r.json());
  }, [rng]);

  const instant = useCallback(async (q: string): Promise<number> => {
    try {
      const r = await fetch(`/api/vm/instant?query=${encodeURIComponent(q)}`);
      if (!r.ok) return 0;
      const d = await r.json();
      return d.status === 'success' && d.data.result.length ? parseFloat(d.data.result[0].values[0][1]) || 0 : 0;
    } catch { return 0; }
  }, []);

  // ── API fetch helpers (authenticated) ─────────────────────────────────
  const fetchApi = useCallback(async <T,>(path: string): Promise<T | null> => {
    if (!tenantId) return null;
    try {
      const r = await fetch(path, { credentials: 'include' });
      if (!r.ok) return null;
      return r.json();
    } catch { return null; }
  }, [tenantId]);

  // ── Main refresh ─────────────────────────────────────────────────────
  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [
        llmLat, llmFb, llmTok, traps, disp, mem, nms,
        upVal, crit, warn, inc, uptm, samps, reqTot,
      ] = await Promise.all([
        query('ftth_llm_latency_seconds:avg15m'),
        query('ftth_llm_fallback:rate15m'),
        query('ftth_copilot_llm_tokens_total'),
        query('ftth_copilot_snmp_traps_total'),
        query('ftth_copilot_router_dispatches_total'),
        query('ftth_copilot_process_memory_bytes'),
        query('ftth_copilot_nms_connections_total'),
        instant('up{job="ftth-copilot-app"}'),
        instant('sum(ftth_ops_active:alerts{severity="critical"})'),
        instant('sum(ftth_ops_active:alerts{severity="warning"})'),
        instant('sum(ftth_ops_active:incidents)'),
        instant('ftth_copilot_process_uptime_seconds'),
        instant('ftth_copilot_metric_samples_total'),
        instant('sum(increase(ftth_copilot_llm_requests_total[15m]))'),
      ]);

      const fbSeries = await query('ftth_llm_fallback:rate15m');
      const tokSeries = await query('sum by (type) (ftth_copilot_llm_tokens_total)');
      const reqSeries = await query('sum(increase(ftth_copilot_llm_requests_total[15m]))');
      const reqPts = reqSeries[0]?.points ?? [];
      const rss = (mem ?? []).find(m => m.labels.type === 'rss');
      const heap = (mem ?? []).find(m => m.labels.type === 'heap_used');
      const latencyByProvider = (llmLat ?? []).reduce<Record<string, { p50: number; p95: number; p99: number; pts: TSPoint[] }>>((acc, s) => {
        const p = s.labels.provider ?? 'unknown';
        if (!acc[p]) acc[p] = { p50: s.current, p95: s.current, p99: s.current, pts: s.points };
        else { acc[p].p50 = s.current; acc[p].pts = s.points; }
        return acc;
      }, {});

      const score = (upVal > 0 ? 35 : 0) + Math.max(0, 35 - crit * 12) + Math.max(0, 15 - warn * 3) + Math.max(0, 15 - inc * 3);

      setHealthScore(score); setUp(upVal > 0); setCriticalAlerts(crit); setWarningAlerts(warn); setIncidents(inc);
      setLlmLatency(Object.entries(latencyByProvider).map(([p, v]) => ({ provider: p, ...v })));
      setDispatches(disp ?? []); setSnmpTraps(traps ?? []);
      setNmsConn((nms ?? []).map(s => ({ provider: s.labels.provider ?? 'unknown', up: s.current > 0, count: Math.round(s.current) })));
      setMemRss(rss?.current ?? 0); setMemHeap(heap?.current ?? 0); setMemRssPts(rss?.points ?? []);
      setUptime(uptm); setSamples(samps);
      setRequestsRate({ total: reqTot, pts: reqPts });
      setLlmFallback((llmFb ?? []).reduce((s, f) => s + f.current, 0));
      setLlmTokens((llmTok ?? []).reduce((s, t) => s + t.current, 0));
      setFbBreakdown(fbSeries.map(s => ({ provider: `${s.labels.primary ?? '?'} → ${s.labels.fallback ?? '?'}`, rate: s.current, pts: s.points })));
      setTokBreakdown(tokSeries);
      setLastPoll(Date.now());
      setUpdated(new Date());

      // ── Authenticated API calls ────────────────────────────────────────
      const [slaData, predData, incData, treeData] = await Promise.all([
        fetchApi<{ windowDays: number; sla: SlaRow[]; count: number }>(`/api/sla?days=7`),
        fetchApi<{ predictions: Prediction[] }>('/api/predictions'),
        fetchApi<{ incidents: Incident[]; count: number }>('/api/incidents'),
        fetchApi<{ roots: TopologyNode[]; nodeCount: number; count: number }>('/api/topology/tree'),
      ]);
      if (slaData?.sla) setSlaRows(slaData.sla);
      if (predData?.predictions) setPredictions(predData.predictions);
      if (incData?.incidents) setApiIncidents(incData.incidents);
      if (treeData?.roots) setTopologyRoots(treeData.roots);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fetch failed');
    } finally {
      setLoading(false);
    }
  }, [query, instant, fetchApi]);

  // ── SSE live counters (replaces the 30s poll for fast-moving values) ──
  // The stream carries the same scalars the Overview tiles render, so a pushed
  // snapshot updates them without a full 15-query refresh. Range series and the
  // authenticated API panels still come from `refresh()` on the slow cadence.
  //
  // The handlers must exist on the very first render: `useSSE` copies them into its
  // own ref during that render, so building them in a later effect would leave it
  // holding an empty object. `useCallback` with stable setters keeps them referentially
  // stable, so the object identity changing per render is harmless.
  const onStreamSnapshot = useCallback((raw: unknown) => {
    const p = (raw as { data?: StreamSnapshot })?.data;
    if (!p) return;
    if (typeof p.healthScore === 'number') setHealthScore(p.healthScore);
    if (typeof p.up === 'boolean') setUp(p.up);
    if (typeof p.criticalAlerts === 'number') setCriticalAlerts(p.criticalAlerts);
    if (typeof p.warningAlerts === 'number') setWarningAlerts(p.warningAlerts);
    if (typeof p.incidents === 'number') setIncidents(p.incidents);
    if (typeof p.memRss === 'number') setMemRss(p.memRss);
    if (typeof p.uptime === 'number') setUptime(p.uptime);
    setLastPoll(Date.now());
  }, []);

  const onStreamDelta = useCallback((raw: unknown) => {
    const d = (raw as { data?: { alerts?: unknown[]; incidents?: unknown[] } })?.data;
    if (!d) return;
    // Any new alert or incident invalidates the AIOps panels, so pull the backfill
    // forward instead of waiting for the slow cadence. Calling refresh from the stream
    // handler (an event callback) also keeps setState out of an effect.
    if ((d.alerts?.length ?? 0) > 0 || (d.incidents?.length ?? 0) > 0) {
      void refresh();
    }
  }, [refresh]);

  const { status: streamStatus } = useSSE(
    tenantId ? '/api/ops/stream' : null,
    { snapshot: onStreamSnapshot, delta: onStreamDelta },
    !!tenantId,
  );

  // ── Initial load + slow backfill ─────────────────────────────────────
  // VM range series and the authenticated API panels cannot be pushed over SSE
  // (they are multi-query range fetches), so they refresh on a slow cadence. Stream
  // pushes cover the fast-moving scalars and pull this forward when something changes.
  useEffect(() => {
    let running = true;
    const poll = async () => { if (running) await refresh(); };
    void poll();
    const id = setInterval(() => { void poll(); }, 120_000);
    return () => { running = false; clearInterval(id); };
  }, [refresh]);

  // ── Derived ──────────────────────────────────────────────────────────
  const dispatchTotal = dispatches.reduce((s, d) => s + d.current, 0);
  const openIncidents = apiIncidents.filter(i => i.status !== 'resolved');
  const mttrMs = apiIncidents.filter(i => i.status === 'resolved').length
    ? apiIncidents.filter(i => i.status === 'resolved')
        .reduce((s, i) => s + (new Date(i.lastSeenAt).getTime() - new Date(i.firstSeenAt).getTime()), 0)
        / apiIncidents.filter(i => i.status === 'resolved').length
    : 0;

  // ── Tab navigation ────────────────────────────────────────────
  type Tab = 'overview' | 'triage' | 'aiops' | 'situations' | 'topology' | 'capacity' | 'timeline' | 'runbooks';
  const [tab, setTab] = useState<Tab>('overview');

  const tabs: Array<{ id: Tab; label: string; icon: string }> = [
    { id: 'overview', label: 'Overview', icon: '📊' },
    { id: 'triage', label: 'Triage', icon: '🔍' },
    { id: 'aiops', label: 'AIOps', icon: '🧠' },
    { id: 'situations', label: 'Situations', icon: '🔗' },
    { id: 'topology', label: 'Topología', icon: '🗺️' },
    { id: 'capacity', label: 'Capacidad', icon: '📈' },
    { id: 'timeline', label: 'Timeline', icon: '📋' },
    { id: 'runbooks', label: 'Runbooks', icon: '📖' },
  ];

  return (
    <div className="space-y-4">

      {/* ── HEADER ─────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold tracking-tight">Observabilidad NOC · AIOps</h2>
            <p className="text-sm text-base-content/50">
              VictoriaMetrics TSDB · Prometheus API
              {updated && <span className="ml-2">· {updated.toLocaleTimeString('es-ES')}</span>}
              <span className="ml-2">· {tr}</span>
              {tab === 'overview' && <StreamBadge status={streamStatus} />}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="join">
              {(Object.keys(TR) as TimeRange[]).map((t) => (
                <button key={t} className={`join-item btn btn-xs ${tr === t ? 'btn-active' : ''}`} onClick={() => setTr(t)}>{t}</button>
              ))}
            </div>
            <button className="btn btn-ghost btn-sm gap-1" onClick={() => void refresh()} disabled={loading}>
              <svg className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </button>
          </div>
        </div>

        {/* Tab bar */}
        <div className="overflow-x-auto rounded-xl border border-base-200 bg-base-100 p-1">
          <div className="flex gap-1">
            {tabs.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all whitespace-nowrap ${
                  tab === t.id
                    ? 'bg-primary text-primary-content shadow-sm'
                    : 'text-base-content/50 hover:bg-base-200 hover:text-base-content'
                }`}
              >
                <span>{t.icon}</span>
                <span>{t.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <div className="alert alert-error">
          <span>Error: {error}</span>
          <button className="btn btn-xs" onClick={() => void refresh()}>Reintentar</button>
        </div>
      )}


      {/* ═══════════════════════════════════════════════════════════════════════
          TAB CONTENT
      ═══════════════════════════════════════════════════════════════════════ */}
      {(tab === 'overview' || tab === 'triage' || tab === 'aiops') && (
      <div>

        {/* ── LAYER 1 OVERVIEW ──────────────────────────────────────── */}
        {tab === 'overview' && (
        <div className="rounded-2xl border border-base-200 bg-base-100/50 p-4">
          <div className="mb-3 flex items-center gap-2">
            <div className="h-px flex-1 bg-gradient-to-r from-base-300 to-transparent" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-base-content/30">
              Layer 1 · Overview — ¿Está funcionando?
            </span>
            <div className="h-px flex-1 bg-gradient-to-l from-base-300 to-transparent" />
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-7">
            {/* Health Score */}
            <div className="col-span-2 flex items-center gap-4 rounded-xl border border-base-200 bg-base-100 p-4">
              <HealthRing score={healthScore} />
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${up ? 'bg-success animate-pulse' : 'bg-error'}`} />
                  <span className="text-xs font-medium">{up ? 'Scraping activo' : 'Scraping caído'}</span>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {[{ v: criticalAlerts, l: 'Críticas', c: 'text-error' }, { v: warningAlerts, l: 'Warning', c: 'text-warning' }, { v: incidents, l: 'Incidentes', c: 'text-warning' }].map((x) => (
                    <div key={x.l} className="text-center">
                      <div className={`font-mono text-lg font-black ${x.c}`}>{x.v}</div>
                      <div className="text-[9px] text-base-content/40">{x.l}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <KpiTile label="Uptime" value={fmtDur(uptime)} spark={[]} />
            <KpiTile label="Samples" value={fmt(samples)} spark={[]} />
            <KpiTile label="Requests (15m)" value={fmt(requestsRate.total)} spark={requestsRate.pts} color="#10b981" />
            <KpiTile label="Tokens consumidos" value={fmt(llmTokens)} spark={[]} />
            <KpiTile label="Incidentes abiertos"
              value={openIncidents.length}
              color={openIncidents.length > 0 ? '#f59e0b' : '#10b981'}
              spark={[]} />
            <KpiTile label="MTTR avg"
              value={mttrMs > 0 ? fmtDur(mttrMs / 1000) : '—'}
              spark={[]} />
          </div>
        </div>
        )}

        {/* ── LAYER 2 TRIAGE ──────────────────────────────────────── */}
        {(tab === 'overview' || tab === 'triage') && (
        <div className="rounded-2xl border border-base-200 bg-base-100/50 p-4">
          <div className="mb-3 flex items-center gap-2">
            <div className="h-px flex-1 bg-gradient-to-r from-base-300 to-transparent" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-base-content/30">
              Layer 2 · Triage — ¿Dónde está el problema?
            </span>
            <div className="h-px flex-1 bg-gradient-to-l from-base-300 to-transparent" />
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">

            {/* ── NMS Connections ── */}
            <div className="rounded-xl border border-base-200 bg-base-100 p-4 flex flex-col gap-3">
              {/* Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-500/10">
                    <svg className="h-4 w-4 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M2 10s3-3 3-8 3 8 3 8m0 0v3m0-3h3m-3 0h-3"/>
                    </svg>
                  </div>
                  <div>
                    <div className="text-sm font-semibold">NMS</div>
                    <div className="text-[10px] text-base-content/40">Connections</div>
                  </div>
                </div>
                <div className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
                  nmsConn.length === 0 ? 'bg-base-200 text-base-content/40' :
                  nmsConn.every(c => c.up) ? 'bg-success/10 text-success border border-success/20' :
                  'bg-warning/10 text-warning border border-warning/20'
                }`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${nmsConn.length === 0 ? 'bg-base-content/30' : nmsConn.every(c => c.up) ? 'bg-success animate-pulse' : 'bg-warning'}`} />
                  {nmsConn.filter(c => c.up).length}/{nmsConn.length}
                </div>
              </div>

              {/* Connection list */}
              {nmsConn.length > 0 ? (
                <div className="space-y-1.5">
                  {nmsConn.map((c) => (
                    <div key={c.provider} className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 bg-base-200/40">
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${c.up ? 'bg-success animate-pulse' : 'bg-error'}`} />
                      <span className="flex-1 text-xs font-medium capitalize text-base-content/80">{c.provider}</span>
                      {c.count > 0 && (
                        <span className="rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px] font-mono font-bold text-warning">{c.count}</span>
                      )}
                      {c.up && (
                        <span className="text-[9px] text-success">online</span>
                      )}
                      {!c.up && (
                        <span className="text-[9px] text-error">offline</span>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-1 flex-col items-center justify-center py-4">
                  <div className="mb-2 text-2xl">📡</div>
                  <div className="text-xs text-base-content/30 text-center">Sin conexiones NMS<br />configuradas</div>
                </div>
              )}
            </div>

            {/* ── Router Dispatch ── */}
            <div className="rounded-xl border border-base-200 bg-base-100 p-4 flex flex-col gap-3">
              {/* Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/10">
                    <svg className="h-4 w-4 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2v-4M9 21H5a2 2 0 0 1-2-2v-4"/>
                    </svg>
                  </div>
                  <div>
                    <div className="text-sm font-semibold">Router</div>
                    <div className="text-[10px] text-base-content/40">Dispatch</div>
                  </div>
                </div>
                {dispatchTotal > 0 ? (
                  <div className="text-right">
                    <div className="font-mono text-lg font-black text-emerald-400">{dispatchTotal.toLocaleString('es-ES')}</div>
                    <div className="text-[9px] text-base-content/40">total</div>
                  </div>
                ) : null}
              </div>

              {/* Dispatch donut + mode list */}
              {dispatchTotal > 0 ? (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-3">
                    <DispatchDonut dispatches={dispatches} />
                    <div className="flex flex-col gap-1.5 flex-1">
                      {dispatches.map((d) => {
                        const col = MODE_COL[d.labels.mode ?? 'unknown'];
                        return (
                          <div key={d.labels.mode} className="flex items-center gap-2">
                            <div className="h-2 w-2 shrink-0 rounded-sm" style={{ backgroundColor: col }} />
                            <span className="flex-1 truncate text-[10px] capitalize text-base-content/60">{d.labels.mode ?? 'unknown'}</span>
                            <Sparkline pts={d.points} color={col} h={16} />
                            <span className="font-mono text-[10px] text-base-content/40 shrink-0">{fmt(d.avg)}/h</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex flex-1 flex-col items-center justify-center py-4">
                  <div className="mb-2 text-2xl">📭</div>
                  <div className="text-xs text-base-content/30 text-center">Sin tráfico de<br />router en este período</div>
                </div>
              )}
            </div>

            {/* ── SNMP Traps ── */}
            <div className="rounded-xl border border-base-200 bg-base-100 p-4 flex flex-col gap-3">
              {/* Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-purple-500/10">
                    <svg className="h-4 w-4 text-purple-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                      <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                    </svg>
                  </div>
                  <div>
                    <div className="text-sm font-semibold">SNMP</div>
                    <div className="text-[10px] text-base-content/40">Traps · {tr}</div>
                  </div>
                </div>
              </div>

              {/* Trap stats */}
              {(() => {
                const received = snmpTraps.find(t => t.labels.status === 'received')?.current ?? 0;
                const deduped = snmpTraps.find(t => t.labels.status === 'deduped')?.current ?? 0;
                const dropped = snmpTraps.find(t => t.labels.status === 'dropped')?.current ?? 0;
                const total = received + deduped + dropped;
                if (total === 0) return (
                  <div className="flex flex-1 flex-col items-center justify-center py-4">
                    <div className="mb-2 text-2xl">🛡️</div>
                    <div className="text-xs text-base-content/30 text-center">Sin traps en<br />este período</div>
                  </div>
                );
                return (
                  <div className="space-y-2">
                    {/* Stacked bar */}
                    <div className="flex h-2 overflow-hidden rounded-full bg-base-200">
                      {received > 0 && <div className="bg-emerald-400" style={{ width: `${(received / total) * 100}%` }} />}
                      {deduped > 0 && <div className="bg-blue-400" style={{ width: `${(deduped / total) * 100}%` }} />}
                      {dropped > 0 && <div className="bg-red-400" style={{ width: `${(dropped / total) * 100}%` }} />}
                    </div>
                    {/* Legend */}
                    <div className="grid grid-cols-3 gap-1">
                      <div className="flex flex-col items-center rounded-lg bg-emerald-500/5 py-2">
                        <span className="font-mono text-lg font-black text-emerald-400">{fmt(received)}</span>
                        <span className="text-[9px] text-emerald-400/60">Recibidos</span>
                      </div>
                      <div className="flex flex-col items-center rounded-lg bg-blue-500/5 py-2">
                        <span className="font-mono text-lg font-black text-blue-400">{fmt(deduped)}</span>
                        <span className="text-[9px] text-blue-400/60">Dedupidos</span>
                      </div>
                      <div className="flex flex-col items-center rounded-lg bg-red-500/5 py-2">
                        <span className={`font-mono text-lg font-black ${dropped > 0 ? 'text-red-400' : 'text-base-content/30'}`}>{fmt(dropped)}</span>
                        <span className="text-[9px] text-red-400/60">Descartados</span>
                      </div>
                    </div>
                    {/* Total */}
                    <div className="text-center text-[10px] text-base-content/40">{total} traps totales</div>
                  </div>
                );
              })()}
            </div>

            {/* ── LLM Fallback ── */}
            <div className="rounded-xl border border-base-200 bg-base-100 p-4 flex flex-col gap-3">
              {/* Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className={`flex h-7 w-7 items-center justify-center rounded-lg ${llmFallback > 0 ? 'bg-warning/10' : 'bg-base-200/50'}`}>
                    <svg className={`h-4 w-4 ${llmFallback > 0 ? 'text-warning' : 'text-base-content/30'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                      <path d="M2 17l10 5 10-5"/>
                      <path d="M2 12l10 5 10-5"/>
                    </svg>
                  </div>
                  <div>
                    <div className="text-sm font-semibold">LLM</div>
                    <div className="text-[10px] text-base-content/40">Provider</div>
                  </div>
                </div>
                <div className={`rounded-full px-2.5 py-1 text-xs font-semibold ${llmFallback > 0 ? 'bg-warning/10 text-warning border border-warning/20' : 'bg-success/10 text-success border border-success/20'}`}>
                  {llmFallback > 0 ? `${llmFallback.toFixed(1)}/15m` : 'OK'}
                </div>
              </div>

              {/* Fallback breakdown or empty */}
              {llmFallback > 0 || fbBreakdown.length > 0 ? (
                <div className="space-y-2">
                  {fbBreakdown.map((s) => (
                    <div key={s.provider} className="flex flex-col gap-1 rounded-lg bg-base-200/30 p-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-semibold text-base-content/70">{s.provider}</span>
                        <span className="font-mono text-xs font-bold text-warning">{s.rate.toFixed(1)}<span className="text-[9px] text-warning/60">/h</span></span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-base-200">
                        <div className="h-full rounded-full bg-warning transition-all" style={{ width: `${Math.min(s.rate * 20, 100)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-1 flex-col items-center justify-center py-4">
                  <div className="mb-2 text-2xl">🤖</div>
                  <div className="text-xs text-base-content/30 text-center">Proveedor LLM<br />operando normalmente</div>
                </div>
              )}
            </div>

            {/* ── Topology ── */}
            <div className="rounded-xl border border-base-200 bg-base-100 p-4 flex flex-col gap-3">
              {/* Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-500/10">
                    <svg className="h-4 w-4 text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/>
                      <path d="M12 7v4m0 0-5 4m5-4 5 4"/>
                    </svg>
                  </div>
                  <div>
                    <div className="text-sm font-semibold">Topología</div>
                    <div className="text-[10px] text-base-content/40">OLT → PON → ONU</div>
                  </div>
                </div>
                <div className="rounded-full bg-base-200 px-2.5 py-1 text-xs font-semibold text-base-content/50">
                  {topologyRoots.length} raíces
                </div>
              </div>

              {/* Tree or empty */}
              {topologyRoots.length > 0 ? (
                <TopologyTree roots={topologyRoots} />
              ) : (
                <div className="flex flex-1 flex-col items-center justify-center py-4">
                  <div className="mb-2 text-2xl">🗺️</div>
                  <div className="text-xs text-base-content/30 text-center">Sin datos de<br />topología</div>
                </div>
              )}
            </div>

          </div>
        </div>
        )}

        {/* ── LAYER 2b AIOps ─────────────────────────────────────── */}
        {(tab === 'overview' || tab === 'aiops') && (
        <div className="rounded-2xl border border-warning/20 bg-warning/5 p-4">
          <div className="mb-3 flex items-center gap-2">
            <div className="h-px flex-1 bg-gradient-to-r from-warning/40 to-transparent" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-warning/80">
              Layer 2b · AIOps — Predicción y tendencia
            </span>
            <div className="h-px flex-1 bg-gradient-to-l from-warning/40 to-transparent" />
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">

            {/* ── Predictions ── */}
            <div className="rounded-xl border border-warning/30 bg-base-100 p-4 flex flex-col gap-3">
              {/* Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className={`flex h-7 w-7 items-center justify-center rounded-lg ${predictions.length > 0 ? 'bg-warning/10' : 'bg-success/10'}`}>
                    <svg className={`h-4 w-4 ${predictions.length > 0 ? 'text-warning' : 'text-success'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M9.348 14.652a3.75 3.75 0 0 1 0-5.304m5.304 0a3.75 3.75 0 0 1 0 5.304m-7.425 2.121a6.75 6.75 0 0 1 0-9.546m9.546 0a6.75 6.75 0 0 1 0 9.546"/>
                    </svg>
                  </div>
                  <div>
                    <div className="text-sm font-semibold">AIOps</div>
                    <div className="text-[10px] text-base-content/40">Predicción</div>
                  </div>
                </div>
                <div className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                  predictions.length === 0 ? 'bg-success/10 text-success border border-success/20' :
                  predictions.some(p => p.severity === 'critical') ? 'bg-error/10 text-error border border-error/20' :
                  'bg-warning/10 text-warning border border-warning/20'
                }`}>
                  {predictions.length === 0 ? 'Clear' : `${predictions.length} active`}
                </div>
              </div>
              <PredictionsPanel predictions={predictions} />
            </div>

            {/* ── Incidents ── */}
            <div className="rounded-xl border border-base-200 bg-base-100 p-4 flex flex-col gap-3">
              {/* Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className={`flex h-7 w-7 items-center justify-center rounded-lg ${openIncidents.length > 0 ? 'bg-error/10' : 'bg-success/10'}`}>
                    <svg className={`h-4 w-4 ${openIncidents.length > 0 ? 'text-error' : 'text-success'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                      <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                    </svg>
                  </div>
                  <div>
                    <div className="text-sm font-semibold">Incidentes</div>
                    <div className="text-[10px] text-base-content/40">Historial y MTTR</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {openIncidents.length > 0 && (
                    <div className="rounded-full bg-error/10 px-2.5 py-1 text-xs font-semibold text-error border border-error/20">
                      {openIncidents.length} abiertos
                    </div>
                  )}
                  {mttrMs > 0 && (
                    <div className="rounded-full bg-base-200 px-2.5 py-1 text-xs font-semibold text-base-content/50">
                      MTTR {fmtDur(mttrMs / 1000)}
                    </div>
                  )}
                </div>
              </div>
              <IncidentsPanel incidents={apiIncidents} now={lastPoll || MODULE_LOAD_MS} />
            </div>

            {/* ── SLA ── */}
            <div className="rounded-xl border border-base-200 bg-base-100 p-4 flex flex-col gap-3">
              {/* Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/10">
                    <svg className="h-4 w-4 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                      <polyline points="22 4 12 14.01 9 11.01"/>
                    </svg>
                  </div>
                  <div>
                    <div className="text-sm font-semibold">SLA</div>
                    <div className="text-[10px] text-base-content/40">7 días</div>
                  </div>
                </div>
                {slaRows.length > 0 && (() => {
                  const validRows = slaRows.filter(r => r.uptimePercent !== null);
                  const avgUp = validRows.reduce((s, r) => s + (r.uptimePercent ?? 0), 0) /
                    Math.max(validRows.length, 1);
                  const col = avgUp >= 99.5 ? '#10b981' : avgUp >= 98 ? '#f59e0b' : '#ef4444';
                  const status = avgUp >= 99.5 ? 'SLA OK' : avgUp >= 98 ? 'Warning' : 'Violation';
                  return (
                    <div className="text-right">
                      <div className="font-mono text-lg font-black" style={{ color: col }}>{avgUp.toFixed(2)}%</div>
                      <div className="text-[9px]" style={{ color: col }}>{status}</div>
                    </div>
                  );
                })()}
              </div>
              <SlaTable rows={slaRows} />
            </div>

          </div>
        </div>
        )}

        {/* ── LAYER 3 DEBUG ─────────────────────────────────────── */}
        {tab === 'overview' && (
        <div className="rounded-2xl border border-base-200 bg-base-100/50 p-4">
          <div className="mb-3 flex items-center gap-2">
            <div className="h-px flex-1 bg-gradient-to-r from-base-300 to-transparent" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-base-content/30">
              Layer 3 · Debug — ¿Por qué?
            </span>
            <div className="h-px flex-1 bg-gradient-to-l from-base-300 to-transparent" />
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">

            {/* ── LLM Latency ── */}
            <div className="rounded-xl border border-base-200 bg-base-100 p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-500/10">
                    <svg className="h-4 w-4 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                    </svg>
                  </div>
                  <div>
                    <div className="text-sm font-semibold">LLM Latency</div>
                    <div className="text-[10px] text-base-content/40">Golden Signal · 15m</div>
                  </div>
                </div>
                <div className="flex gap-1.5">
                  {['p50', 'p95', 'p99'].map(p => (
                    <span key={p} className="rounded-full bg-base-200 px-2 py-0.5 text-[9px] font-mono text-base-content/40">{p}</span>
                  ))}
                </div>
              </div>
              <GoldenLatency series={llmLatency} />
            </div>

            {/* ── Memory ── */}
            <div className="rounded-xl border border-base-200 bg-base-100 p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-purple-500/10">
                    <svg className="h-4 w-4 text-purple-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 8h.01M10 8h.01M14 8h.01"/>
                    </svg>
                  </div>
                  <div>
                    <div className="text-sm font-semibold">Memoria</div>
                    <div className="text-[10px] text-base-content/40">Golden Signal · Saturation</div>
                  </div>
                </div>
                {memRss > 0 && (() => {
                  const pct = (memRss / (512 * 1_048_576)) * 100;
                  const col = pct >= 85 ? '#ef4444' : pct >= 70 ? '#f59e0b' : '#3b82f6';
                  return (
                    <div className="text-right">
                      <span className="font-mono text-sm font-bold" style={{ color: col }}>{pct.toFixed(1)}%</span>
                      <div className="text-[9px] text-base-content/40">{(memRss / 1_048_576).toFixed(0)} MB</div>
                    </div>
                  );
                })()}
              </div>
              <div className="space-y-3">
                <SatBar label="RSS" current={memRss} limit={512 * 1_048_576} />
                <SatBar label="Heap usado" current={memHeap} limit={256 * 1_048_576} color="#8b5cf6" />
              </div>
              {memRssPts.length >= 2 && (
                <div className="rounded-lg bg-base-200/40 p-2">
                  <div className="mb-1 text-[9px] text-base-content/40">RSS · {tr}</div>
                  <Sparkline pts={memRssPts} color="#3b82f6" h={36} />
                </div>
              )}
            </div>

            {/* ── Throughput ── */}
            <div className="rounded-xl border border-base-200 bg-base-100 p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/10">
                    <svg className="h-4 w-4 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
                    </svg>
                  </div>
                  <div>
                    <div className="text-sm font-semibold">Throughput</div>
                    <div className="text-[10px] text-base-content/40">Golden Signal · Traffic · {tr}</div>
                  </div>
                </div>
                <div className="text-right">
                  <span className="font-mono text-2xl font-black text-emerald-400">{fmt(requestsRate.total)}</span>
                  <div className="text-[9px] text-base-content/40">requests</div>
                </div>
              </div>
              {requestsRate.pts.length >= 2 && (
                <div className="rounded-lg bg-base-200/40 p-2">
                  <Sparkline pts={requestsRate.pts} color="#10b981" h={44} />
                </div>
              )}
            </div>

            {/* ── Tokens ── */}
            <div className="rounded-xl border border-base-200 bg-base-100 p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/10">
                    <svg className="h-4 w-4 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/>
                    </svg>
                  </div>
                  <div>
                    <div className="text-sm font-semibold">Tokens LLM</div>
                    <div className="text-[10px] text-base-content/40">Consumo acumulado</div>
                  </div>
                </div>
                <div className="text-right">
                  <span className="font-mono text-lg font-black text-amber-400">{fmt(llmTokens)}</span>
                  <div className="text-[9px] text-base-content/40">total</div>
                </div>
              </div>
              {tokBreakdown.length > 0 ? (
                <div className="space-y-2">
                  {tokBreakdown.map((s, i) => {
                    const col = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6'][i % 4];
                    const pct = Math.min((s.current / Math.max(llmTokens, 1)) * 100, 100);
                    return (
                      <div key={i} className="flex flex-col gap-1 rounded-lg bg-base-200/30 p-2">
                        <div className="flex items-center justify-between">
                          <span className="truncate text-[10px] font-semibold text-base-content/70 capitalize">
                            {s.labels.type ?? 'unknown'}
                          </span>
                          <span className="font-mono text-xs font-bold" style={{ color: col }}>{fmt(s.current)}</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-base-200">
                          <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: col }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="flex flex-1 flex-col items-center justify-center py-4">
                  <div className="mb-2 text-2xl">💬</div>
                  <div className="text-xs text-base-content/30 text-center">Sin datos de<br />tokens LLM</div>
                </div>
              )}
            </div>

          </div>
        </div>
        )}

      </div>
      )}

      {/* NEW TAB PANELS */}
      {tab === 'situations' && (
        <div className="rounded-2xl border border-base-200 bg-base-100 p-4">
          <SituationsPanel />
        </div>
      )}

      {tab === 'topology' && (
        <div className="rounded-2xl border border-base-200 bg-base-100 p-4">
          <NetworkTopologyMap />
        </div>
      )}

      {tab === 'capacity' && (
        <div className="rounded-2xl border border-base-200 bg-base-100 p-4">
          <CapacityForecast />
        </div>
      )}

      {tab === 'timeline' && (
        <div className="rounded-2xl border border-base-200 bg-base-100 p-4">
          <ChangeTimeline />
        </div>
      )}

      {tab === 'runbooks' && (
        <div className="rounded-2xl border border-base-200 bg-base-100 p-4">
          <RunbookPanel />
        </div>
      )}

      {/* ── Recording rules + VM UI (shown on overview) ───── */}
      {tab === 'overview' && (
      <>
      <RulesRef />
      <div className="rounded-xl border border-dashed border-base-300 bg-base-100 p-4 text-center">
        <p className="text-sm text-base-content/50">
          Exploración avanzada:{' '}
          <a href="http://localhost:8428" target="_blank" rel="noopener noreferrer"
            className="link link-primary font-medium">
            VictoriaMetrics VMUI (:8428)
          </a>
          {' '}· Prometheus API{' '}
          <code className="text-xs">/api/vm/query</code>
        </p>
      </div>
      </>
      )}

    </div>
  );
}
