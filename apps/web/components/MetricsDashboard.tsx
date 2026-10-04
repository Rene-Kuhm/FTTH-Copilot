'use client';

import { useCallback, useEffect, useState } from 'react';

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

// ─────────────────────────────────────────────────────────────────────────────
// Parse helpers
// ─────────────────────────────────────────────────────────────────────────────

function parseVM(raw: VMResponse): Series[] {
  if (raw.status !== 'success') return [];
  return raw.data.result.map((r) => {
    const pts: TSPoint[] = r.values.map(([t, v]) => ({ timestamp: t, value: parseFloat(v) || 0 }));
    const vs = pts.map((p) => p.value);
    return {
      name: r.metric.__name__ ?? '?',
      labels: r.metric,
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
// SVG: Health Score Ring
// ─────────────────────────────────────────────────────────────────────────────

function HealthRing({ score }: { score: number }) {
  const r = 38, circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  const col = score >= 85 ? '#10b981' : score >= 60 ? '#f59e0b' : score > 0 ? '#ef4444' : '#6b7280';
  const label = score >= 85 ? 'Operational' : score >= 60 ? 'Degraded' : score > 0 ? 'Critical' : 'Unknown';
  return (
    <div className="flex flex-col items-center">
      <svg width="96" height="96" viewBox="0 0 96 96">
        <circle cx="48" cy="48" r={r} fill="none" stroke="var(--color-base-300)" strokeWidth="8" />
        <circle cx="48" cy="48" r={r} fill="none" stroke={col} strokeWidth="8"
          strokeLinecap="round" strokeDasharray={`${dash} ${circ}`}
          strokeDashoffset={circ * 0.25} transform="rotate(-90 48 48)"
          style={{ transition: 'stroke-dasharray 0.8s ease' }} />
        <text x="48" y="43" textAnchor="middle" dominantBaseline="middle"
          className="fill-base-content font-mono text-xl font-black">{Math.round(score)}</text>
        <text x="48" y="58" textAnchor="middle" dominantBaseline="middle"
          className="fill-base-content/40" style={{ fontSize: '9px' }}>de 100</text>
      </svg>
      <span className="mt-1 text-xs font-semibold" style={{ color: col }}>{label}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// KPI Tile — big number with optional sparkline
// ─────────────────────────────────────────────────────────────────────────────

function KpiTile({
  label, value, unit, spark, trend, color = 'var(--color-base-content)',
  bgClass = '', highlight = false
}: {
  label: string; value: string | number; unit?: string;
  spark?: TSPoint[]; trend?: number;
  color?: string; bgClass?: string; highlight?: boolean;
}) {
  const tc = trend === undefined ? '' : trend > 0 ? 'text-error' : trend < 0 ? 'text-success' : 'text-base-content/40';
  return (
    <div className={`flex flex-1 flex-col gap-2 rounded-xl border p-4 ${bgClass} ${highlight ? 'ring-1 ring-error/20' : 'border-base-200'}`}>
      <span className="text-xs font-medium text-base-content/50 uppercase tracking-wider">{label}</span>
      <div className="flex items-end justify-between gap-2">
        <div className="flex items-baseline gap-1">
          <span className="font-mono text-2xl font-black" style={{ color }}>{value}</span>
          {unit && <span className="text-xs text-base-content/40">{unit}</span>}
        </div>
        {spark && spark.length >= 2 && (
          <div className="w-14 shrink-0"><Sparkline pts={spark} color={color} h={24} /></div>
        )}
      </div>
      {trend !== undefined && (
        <span className={`text-xs font-mono ${tc}`}>
          {trend >= 0 ? '↑' : '↓'} {Math.abs(trend).toFixed(1)}% período
        </span>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Golden Signal: Latency bar with p50/p95/p99
// ─────────────────────────────────────────────────────────────────────────────

function GoldenLatency({ series, thresholds }: {
  series: Array<{ provider: string; p50: number; p95: number; p99: number; pts: TSPoint[] }>;
  thresholds?: { warn: number; crit: number };
}) {
  const thr = thresholds ?? { warn: 1000, crit: 2000 };
  if (!series.length) return (
    <div className="space-y-2">
      {['Provider A', 'Provider B'].map((p, i) => (
        <div key={p} className="flex items-center gap-3">
          <span className="w-20 text-xs text-base-content/50 truncate">{p}</span>
          <div className="h-2 flex-1 rounded-full bg-base-200" />
          <span className="w-16 text-right font-mono text-xs text-base-content/30">—</span>
        </div>
      ))}
    </div>
  );

  return (
    <div className="space-y-2.5">
      {series.map((s) => {
        const { p50, p95, p99, pts, provider } = s;
        const p99pct = Math.min((p99 / thr.crit) * 100, 100);
        const p95pct = Math.min((p95 / thr.crit) * 100, 100);
        const col = p99 >= thr.crit ? '#ef4444' : p99 >= thr.warn ? '#f59e0b' : '#10b981';
        return (
          <div key={provider} className="flex items-center gap-3">
            <span className="w-20 text-xs text-base-content/50 truncate font-medium">{provider}</span>
            <div className="flex flex-1 flex-col gap-1">
              <div className="relative h-2 overflow-hidden rounded-full bg-base-200">
                <div className="absolute left-0 h-full rounded-full opacity-30" style={{ width: `${p99pct}%`, backgroundColor: col }} />
                <div className="absolute left-0 h-full rounded-full opacity-60" style={{ width: `${p95pct}%`, backgroundColor: col }} />
                <div className="h-full rounded-full" style={{ width: `${Math.min((p50 / thr.crit) * 100, 100)}%`, backgroundColor: col }} />
              </div>
              <div className="flex gap-2 text-[9px] text-base-content/40">
                <span className="w-14">p50 <span className="font-mono">{fmtMs(p50)}</span></span>
                <span className="w-14">p95 <span className="font-mono">{fmtMs(p95)}</span></span>
                <span className="w-14">p99 <span className="font-mono">{fmtMs(p99)}</span></span>
              </div>
            </div>
            {pts.length >= 2 && <div className="w-12 shrink-0"><Sparkline pts={pts.map(p => ({ ...p, value: p.value * 1000 }))} color={col} h={20} /></div>}
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Golden Signal: Error Rate bar (% of traffic)
// ─────────────────────────────────────────────────────────────────────────────

function GoldenErrorRate({ series }: {
  series: Array<{ status: string; rate: number; pts: TSPoint[] }>;
}) {
  return (
    <div className="space-y-2">
      {series.map((s) => {
        const col = s.status === '5xx' || s.status === 'error' ? '#ef4444'
          : s.status === '4xx' ? '#f59e0b' : '#10b981';
        return (
          <div key={s.status} className="flex items-center gap-3">
            <span className="w-12 text-xs font-medium" style={{ color: col }}>{s.status}</span>
            <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-base-200">
              <div className="h-full rounded-full" style={{ width: `${Math.min(s.rate * 100, 100)}%`, backgroundColor: col }} />
            </div>
            <span className="w-14 text-right font-mono text-xs" style={{ color: col }}>
              {(s.rate * 100).toFixed(2)}%
            </span>
            {s.pts.length >= 2 && <div className="w-12 shrink-0"><Sparkline pts={s.pts.map(p => ({ ...p, value: p.value * 100 }))} color={col} h={16} /></div>}
          </div>
        );
      })}
      {!series.length && (
        <div className="py-2 text-center text-xs text-base-content/30">Sin datos de errores</div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Golden Signal: Saturation bar (% of limit)
// ─────────────────────────────────────────────────────────────────────────────

function GoldenSaturation({ label, current, limit, color = '#3b82f6', unit = 'B' }: {
  label: string; current: number; limit: number; color?: string; unit?: string;
}) {
  const pct = limit > 0 ? (current / limit) * 100 : 0;
  const col = pct >= 90 ? '#ef4444' : pct >= 70 ? '#f59e0b' : color;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-base-content/60">{label}</span>
        <span className="font-mono font-medium" style={{ color: col }}>
          {fmtB(current)} / {fmtB(limit)}
        </span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-base-200">
        <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: col }} />
      </div>
      <div className="flex justify-between text-[9px] text-base-content/40">
        <span>0%</span>
        <span style={{ color: pct >= 70 ? col : undefined }}>{pct.toFixed(1)}%</span>
        <span>100%</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Dispatch Ratio donut + breakdown
// ─────────────────────────────────────────────────────────────────────────────

const MODE_COL: Record<string, string> = { direct: '#10b981', assisted: '#3b82f6', investigation: '#f59e0b', unknown: '#6b7280' };

function DispatchDonut({ dispatches }: { dispatches: Series[] }) {
  const total = dispatches.reduce((s, d) => s + d.current, 0);
  if (!total) return (
    <div className="flex h-20 items-center justify-center">
      <span className="text-xs text-base-content/30">Sin tráfico de router</span>
    </div>
  );
  const slices = dispatches.reduce<Array<{ pct: number; start: number; end: number } & Series>>((acc2, d) => {
    const pct = (d.current / total) * 100;
    const start = acc2.length ? acc2[acc2.length - 1].end : 0;
    acc2.push({ ...d, pct, start, end: start + pct });
    return acc2;
  }, []);
  const r = 28, circ = 2 * Math.PI * r;
  return (
    <div className="flex items-center gap-4">
      <svg width="72" height="72" viewBox="0 0 72 72">
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
        <text x={r} y={r - 3} textAnchor="middle" dominantBaseline="middle"
          className="fill-base-content font-mono text-sm font-bold" style={{ fontSize: '11px' }}>{fmt(total)}</text>
        <text x={r} y={r + 9} textAnchor="middle" dominantBaseline="middle"
          className="fill-base-content/40" style={{ fontSize: '8px' }}>total</text>
      </svg>
      <div className="flex flex-col gap-1.5">
        {slices.map((s) => (
          <div key={s.labels.mode} className="flex items-center gap-2">
            <div className="h-2 w-3 rounded-sm" style={{ backgroundColor: MODE_COL[s.labels.mode ?? 'unknown'] }} />
            <span className="w-24 text-xs capitalize text-base-content/70">{s.labels.mode ?? 'unknown'}</span>
            <span className="font-mono text-xs font-semibold">{s.pct.toFixed(0)}%</span>
            <span className="text-xs text-base-content/40">({fmt(s.current)})</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// NMS Status Panel
// ─────────────────────────────────────────────────────────────────────────────

function NmsPanel({ connections }: {
  connections: Array<{ provider: string; up: boolean; count: number }>;
}) {
  if (!connections.length) return (
    <span className="text-xs text-base-content/30">Sin conexiones NMS activas</span>
  );
  return (
    <div className="flex flex-wrap gap-2">
      {connections.map((c) => (
        <div key={c.provider}
          className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 ${c.up ? 'border-success/30 bg-success/5' : 'border-error/30 bg-error/5'}`}>
          <span className={`h-2 w-2 rounded-full ${c.up ? 'bg-success' : 'bg-error'} animate-pulse`} />
          <span className="text-xs font-medium capitalize">{c.provider}</span>
          <span className="text-xs text-base-content/40">{c.up ? 'up' : 'down'}</span>
          {c.count > 0 && <span className="font-mono text-[10px] text-base-content/40">×{c.count}</span>}
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SNMP Traps Panel — rate bar
// ─────────────────────────────────────────────────────────────────────────────

function TrapsPanel({ traps }: { traps: Series[] }) {
  const by = (k: string) => traps.find((t) => t.labels.status === k)?.current ?? 0;
  const rcv = by('received'), ded = by('deduped'), drp = by('dropped');
  const tot = rcv + ded + drp;
  const rate = tot; // simplified: count
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
        <div className={`rounded-lg border p-3 text-center ${rcv ? 'border-success/30 bg-success/5' : 'border-base-200 bg-base-100'}`}>
          <div className={`font-mono text-xl font-black ${rcv ? 'text-success' : 'text-base-content/20'}`}>{fmt(rcv)}</div>
          <div className="mt-0.5 text-[10px] text-base-content/50">Recibidos</div>
        </div>
        <div className={`rounded-lg border p-3 text-center ${ded ? 'border-primary/30 bg-primary/5' : 'border-base-200 bg-base-100'}`}>
          <div className={`font-mono text-xl font-black ${ded ? 'text-primary' : 'text-base-content/20'}`}>{fmt(ded)}</div>
          <div className="mt-0.5 text-[10px] text-base-content/50">Dedupidos</div>
        </div>
        <div className={`rounded-lg border p-3 text-center ${drp ? 'border-error/30 bg-error/5' : 'border-base-200 bg-base-100'}`}>
          <div className={`font-mono text-xl font-black ${drp ? 'text-error' : 'text-base-content/20'}`}>{fmt(drp)}</div>
          <div className="mt-0.5 text-[10px] text-base-content/50">Descartados</div>
        </div>
      </div>
      {tot > 0 && (
        <div className="h-2 overflow-hidden rounded-full bg-base-200">
          <div className="flex h-full">
            {rcv > 0 && <div className="bg-success" style={{ width: `${(rcv / tot) * 100}%` }} />}
            {ded > 0 && <div className="bg-primary" style={{ width: `${(ded / tot) * 100}%` }} />}
            {drp > 0 && <div className="bg-error" style={{ width: `${(drp / tot) * 100}%` }} />}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Alert Feed — last N alerts with severity
// ─────────────────────────────────────────────────────────────────────────────

function AlertFeed({ critical, warning }: { critical: number; warning: number }) {
  const items = [
    ...Array(critical).fill({ sev: 'critical' as const, text: 'Alerta crítica activa' }),
    ...Array(warning).fill({ sev: 'warning' as const, text: 'Alerta warning activa' }),
  ];
  if (!items.length) return (
    <div className="flex items-center gap-2 py-2 text-xs text-success">
      <span className="h-2 w-2 rounded-full bg-success" />
      Sin alertas activas
    </div>
  );
  return (
    <div className="space-y-1">
      {items.map((item, i) => (
        <div key={i} className={`flex items-center gap-2 rounded-md px-2 py-1 text-xs ${
          item.sev === 'critical' ? 'bg-error/10 text-error' : 'bg-warning/10 text-warning'
        }`}>
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${item.sev === 'critical' ? 'bg-error animate-pulse' : 'bg-warning'}`} />
          {item.text}
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SLO Burn Rate mini indicator
// ─────────────────────────────────────────────────────────────────────────────

function SloBurnRate({ errorRate, sloTarget = 0.99 }: { errorRate: number; sloTarget?: number }) {
  // Burn rate = error rate / (1 - sloTarget). >14.4 = fast burn, >6 = slow burn
  const burnRate = errorRate > 0 ? errorRate / (1 - sloTarget) : 0;
  const col = burnRate >= 14.4 ? '#ef4444' : burnRate >= 6 ? '#f59e0b' : '#10b981';
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-base-content/50">Error Budget Burn</span>
        <span className="font-mono text-xs font-bold" style={{ color: col }}>
          {burnRate >= 100 ? '—' : burnRate.toFixed(1)}×
        </span>
      </div>
      <div className="relative h-1.5 overflow-hidden rounded-full bg-base-200">
        <div className="absolute left-0 h-full rounded-full" style={{ width: `${Math.min(burnRate * 2, 100)}%`, backgroundColor: col }} />
      </div>
      <div className="flex justify-between text-[9px] text-base-content/30">
        <span>0×</span>
        <span>6× slow</span>
        <span>14× fast</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Recording Rules Reference (collapsible)
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
      <summary className="cursor-pointer px-4 py-2.5 text-xs font-medium text-base-content/50 hover:bg-base-200/30">
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
  const [tr, setTr] = useState<TimeRange>('15m');
  const [loading, setLoading] = useState(false);
  const [updated, setUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── State ──────────────────────────────────────────────────────────────
  const [healthScore, setHealthScore] = useState(0);
  const [up, setUp] = useState(false);
  const [criticalAlerts, setCriticalAlerts] = useState(0);
  const [warningAlerts, setWarningAlerts] = useState(0);
  const [incidents, setIncidents] = useState(0);

  // Golden signals
  const [llmLatency, setLlmLatency] = useState<Array<{ provider: string; p50: number; p95: number; p99: number; pts: TSPoint[] }>>([]);
  const [errorRates, setErrorRates] = useState<Array<{ status: string; rate: number; pts: TSPoint[] }>>([]);
  const [requestsRate, setRequestsRate] = useState<{ total: number; pts: TSPoint[] }>({ total: 0, pts: [] });

  // Saturation
  const [memRss, setMemRss] = useState(0);
  const [memHeap, setMemHeap] = useState(0);
  const [memRssLimit] = useState(512 * 1_048_576); // 512 MiB assumed
  const [memHeapLimit] = useState(256 * 1_048_576); // 256 MiB assumed
  const [memRssPts, setMemRssPts] = useState<TSPoint[]>([]);

  // Dispatch
  const [dispatches, setDispatches] = useState<Series[]>([]);
  const [dispatchRate, setDispatchRate] = useState<Series[]>([]);

  // SNMP
  const [snmpTraps, setSnmpTraps] = useState<Series[]>([]);

  // NMS
  const [nmsConn, setNmsConn] = useState<Array<{ provider: string; up: boolean; count: number }>>([]);

  // System
  const [uptime, setUptime] = useState(0);
  const [samples, setSamples] = useState(0);
  const [llmFallback, setLlmFallback] = useState(0);
  const [llmTokens, setLlmTokens] = useState(0);
  const [fbBreakdown, setFbBreakdown] = useState<Array<{ provider: string; rate: number; pts: TSPoint[] }>>([]);
  const [tokBreakdown, setTokBreakdown] = useState<Series[]>([]);

  const rng = TR[tr];

  // ── Data fetching ───────────────────────────────────────────────────────
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

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [llmLat, llmFb, llmTok, traps, disp, dispR, mem, nms, upVal, crit, warn, inc, uptm, samps, reqTot] =
        await Promise.all([
          query('ftth_llm_latency_seconds:avg15m'),
          query('ftth_llm_fallback:rate15m'),
          query('ftth_copilot_llm_tokens_total'),
          query('ftth_copilot_snmp_traps_total'),
          query('ftth_copilot_router_dispatches_total'),
          query('ftth_router_dispatches:rate1h'),
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

      // Parse LLM latency per provider
      const latencyByProvider = (llmLat ?? []).reduce<Record<string, { p50: number; p95: number; p99: number; pts: TSPoint[] }>>((acc, s) => {
        const p = s.labels.provider ?? 'unknown';
        if (!acc[p]) acc[p] = { p50: s.current, p95: s.current, p99: s.current, pts: s.points };
        else { acc[p].p50 = s.current; acc[p].pts = s.points; }
        return acc;
      }, {});

      // Fallback rate
      const fbRate = (llmFb ?? []).reduce((s, f) => s + f.current, 0);
      const tokenTotal = (llmTok ?? []).reduce((s, t) => s + t.current, 0);

      // Error rates (derived from LLM requests)
      const errByStatus = (await query('sum by (status) (increase(ftth_copilot_llm_requests_total{status!="ok"}[15m]))')).map(s => ({
        status: s.labels.status ?? 'unknown',
        rate: s.current / Math.max(reqTot, 1),
        pts: s.points.map(p => ({ ...p, value: p.value / Math.max(reqTot, 1) })),
      }));
      const okPts = (await query('sum by (status) (increase(ftth_copilot_llm_requests_total{status="ok"}[15m]))')).map(s => ({
        status: '2xx', rate: s.current / Math.max(reqTot, 1),
        pts: s.points.map(p => ({ ...p, value: p.value / Math.max(reqTot, 1) })),
      }));
      const allErrRates = [...errByStatus.filter(e => e.status !== 'ok'), ...okPts].filter(e => e.rate > 0 || e.pts.length > 0);

      // Requests rate
      const reqPts = (await query('sum(increase(ftth_copilot_llm_requests_total[15m]))'))[0]?.points ?? [];

      // Health score
      const score = (upVal > 0 ? 35 : 0)
        + Math.max(0, 35 - criticalAlerts * 12)
        + Math.max(0, 15 - warningAlerts * 3)
        + Math.max(0, 15 - inc * 3);

      // Memory
      const rss = (mem ?? []).find(m => m.labels.type === 'rss');
      const heap = (mem ?? []).find(m => m.labels.type === 'heap_used');

      // NMS
      const nmsList = (nms ?? []).map(s => ({
        provider: s.labels.provider ?? 'unknown',
        up: s.current > 0,
        count: Math.round(s.current),
      }));

      setHealthScore(score);
      setUp(upVal > 0);
      setCriticalAlerts(crit);
      setWarningAlerts(warn);
      setIncidents(inc);
      setLlmLatency(Object.entries(latencyByProvider).map(([p, v]) => ({ provider: p, ...v })));
      setErrorRates(allErrRates);
      setRequestsRate({ total: reqTot, pts: reqPts });
      setMemRss(rss?.current ?? 0);
      setMemHeap(heap?.current ?? 0);
      setMemRssPts(rss?.points ?? []);
      setDispatches(disp ?? []);
      setDispatchRate(dispR ?? []);
      setSnmpTraps(traps ?? []);
      setNmsConn(nmsList);
      setUptime(uptm);
      setSamples(samps);
      setLlmFallback(fbRate);
      setLlmTokens(tokenTotal);
      const fbSeries = await query('ftth_llm_fallback:rate15m');
      setFbBreakdown(fbSeries.map(s => ({
        provider: `${s.labels.primary ?? '?'} → ${s.labels.fallback ?? '?'}`,
        rate: s.current,
        pts: s.points,
      })));
      const tokSeries = await query('sum by (type) (ftth_copilot_llm_tokens_total)');
      setTokBreakdown(tokSeries);
      setUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fetch failed');
    } finally {
      setLoading(false);
    }
  }, [query, instant, criticalAlerts, warningAlerts]);

  useEffect(() => {
    let running = true;
    const poll = async () => { if (running) await refresh(); };
    void poll();
    const id = setInterval(() => { void poll(); }, 30_000);
    return () => { running = false; clearInterval(id); };
  }, [refresh]);

  // ── Render ──────────────────────────────────────────────────────────────
  const dispatchTotal = dispatches.reduce((s, d) => s + d.current, 0);
  const errorRateTotal = errorRates.reduce((s, e) => s + e.rate, 0);
  const errBurnRate = errorRateTotal / Math.max(1 - 0.99, 0.001);

  return (
    <div className="space-y-5">

      {/* ── HEADER ───────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold tracking-tight">Observabilidad NOC · AIOps</h2>
          <p className="text-sm text-base-content/50">
            VictoriaMetrics TSDB · Prometheus API
            {updated && <span className="ml-2">· {updated.toLocaleTimeString('es-ES')}</span>}
            <span className="ml-2">· rango: {tr}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="join">
            {(Object.keys(TR) as TimeRange[]).map((t) => (
              <button key={t} className={`join-item btn btn-xs ${tr === t ? 'btn-active' : ''}`}
                onClick={() => setTr(t)}>{t}</button>
            ))}
          </div>
          <button className="btn btn-ghost btn-sm gap-1" onClick={() => void refresh()} disabled={loading}>
            <svg className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </button>
        </div>
      </div>

      {error && (
        <div className="alert alert-error">
          <span>Error: {error}</span>
          <button className="btn btn-xs" onClick={() => void refresh()}>Reintentar</button>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          LAYER 1 — OVERVIEW: Is it working?
      ═══════════════════════════════════════════════════════════════════════ */}
      <div className="rounded-2xl border border-base-200 bg-base-100/50 p-4">
        <div className="mb-3 flex items-center gap-2">
          <div className="h-px flex-1 bg-gradient-to-r from-base-300 to-transparent" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-base-content/30">
            Layer 1 · Overview — ¿Está funcionando?
          </span>
          <div className="h-px flex-1 bg-gradient-to-l from-base-300 to-transparent" />
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
          {/* Health Score */}
          <div className="col-span-2 flex items-center gap-4 rounded-xl border border-base-200 bg-base-100 p-4">
            <HealthRing score={healthScore} />
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${up ? 'bg-success animate-pulse' : 'bg-error'}`} />
                <span className="text-xs font-medium">{up ? 'Scraping activo' : 'Scraping caído'}</span>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="text-center">
                  <div className="font-mono text-lg font-black text-error">{criticalAlerts}</div>
                  <div className="text-[9px] text-base-content/40">Críticas</div>
                </div>
                <div className="text-center">
                  <div className="font-mono text-lg font-black text-warning">{warningAlerts}</div>
                  <div className="text-[9px] text-base-content/40">Warning</div>
                </div>
                <div className="text-center">
                  <div className="font-mono text-lg font-black" style={{ color: incidents > 0 ? '#f59e0b' : 'var(--color-success)' }}>
                    {incidents}
                  </div>
                  <div className="text-[9px] text-base-content/40">Incidentes</div>
                </div>
              </div>
            </div>
          </div>

          {/* SLO Burn Rate */}
          <div className="col-span-2 flex flex-col justify-center rounded-xl border border-base-200 bg-base-100 p-4">
            <span className="mb-2 text-[10px] font-bold uppercase tracking-widest text-base-content/40">
              Error Budget Burn Rate
            </span>
            <SloBurnRate errorRate={errorRateTotal} />
            <div className="mt-2 text-[9px] text-base-content/30">
              Budget consumido: <span className="font-mono font-medium">{(errBurnRate * 100).toFixed(2)}%</span>
              · SLO 99% · ventana {tr}
            </div>
          </div>

          {/* Uptime */}
          <KpiTile label="Uptime" value={fmtDur(uptime)} spark={[]} />

          {/* Samples VM */}
          <KpiTile label="Samples en VM" value={fmt(samples)} spark={[]} />

          {/* Requests 15m */}
          <KpiTile label="Requests LLM (15m)" value={fmt(requestsRate.total)} spark={requestsRate.pts} />

          {/* Tokens */}
          <KpiTile label="Tokens consumidos" value={fmt(llmTokens)} spark={[]} />
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          LAYER 2 — TRIAGE: Where is the problem?
      ═══════════════════════════════════════════════════════════════════════ */}
      <div className="rounded-2xl border border-base-200 bg-base-100/50 p-4">
        <div className="mb-3 flex items-center gap-2">
          <div className="h-px flex-1 bg-gradient-to-r from-base-300 to-transparent" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-base-content/30">
            Layer 2 · Triage — ¿Dónde está el problema?
          </span>
          <div className="h-px flex-1 bg-gradient-to-l from-base-300 to-transparent" />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">

          {/* NMS Connections */}
          <div className="rounded-xl border border-base-200 bg-base-100 p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-semibold">NMS Connections</span>
              <span className="badge badge-sm badge-outline">{nmsConn.filter(c => c.up).length}/{nmsConn.length} up</span>
            </div>
            <NmsPanel connections={nmsConn} />
          </div>

          {/* Router Dispatch Ratio */}
          <div className="rounded-xl border border-base-200 bg-base-100 p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold">Router · Dispatch Ratio</div>
                <div className="text-xs text-base-content/40">
                  {dispatchTotal > 0 ? `${dispatchTotal.toLocaleString('es-ES')} dispatches totales` : 'Sin tráfico'}
                </div>
              </div>
              <DispatchDonut dispatches={dispatches} />
            </div>
            {/* Dispatch sparklines */}
            {dispatches.map((d) => {
              const col = MODE_COL[d.labels.mode ?? 'unknown'];
              return (
                <div key={d.labels.mode} className="mt-2 flex items-center gap-2">
                  <span className="w-24 text-xs capitalize text-base-content/60">{d.labels.mode ?? 'unknown'}</span>
                  <Sparkline pts={d.points} color={col} h={20} />
                  <span className="ml-auto font-mono text-xs text-base-content/40">{fmt(d.avg)}/h avg</span>
                </div>
              );
            })}
          </div>

          {/* SNMP Traps */}
          <div className="rounded-xl border border-base-200 bg-base-100 p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-semibold">SNMP Traps</span>
              <span className="text-xs text-base-content/40">últimas {tr}</span>
            </div>
            <TrapsPanel traps={snmpTraps} />
          </div>

          {/* Active Alerts Feed */}
          <div className="rounded-xl border border-base-200 bg-base-100 p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-semibold">Alert Feed</span>
              <span className="badge badge-sm badge-error">{criticalAlerts + warningAlerts} activas</span>
            </div>
            <AlertFeed critical={criticalAlerts} warning={warningAlerts} />
          </div>

          {/* LLM Fallback */}
          <div className="rounded-xl border border-base-200 bg-base-100 p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-semibold">LLM Provider Fallback</span>
              <span className={`badge badge-sm ${llmFallback > 0 ? 'badge-warning' : 'badge-success'}`}>
                {llmFallback > 0 ? `${llmFallback.toFixed(1)}/15m` : 'sin fallbacks'}
              </span>
            </div>
            <div className="space-y-1.5">
              {fbBreakdown.map((s, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-28 truncate text-[10px] text-base-content/60">{s.provider}</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-base-200">
                    <div className="h-full rounded-full bg-warning transition-all"
                      style={{ width: `${Math.min(s.rate * 20, 100)}%` }} />
                  </div>
                  <span className="font-mono text-xs text-warning">{s.rate.toFixed(1)}/h</span>
                </div>
              ))}
            </div>
          </div>

          {/* LLM Tokens breakdown */}
          <div className="rounded-xl border border-base-200 bg-base-100 p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-semibold">LLM Tokens</span>
              <span className="font-mono text-xs font-bold">{fmt(llmTokens)} total</span>
            </div>
            <div className="space-y-1.5">
              {tokBreakdown.map((s, i) => {
                const col = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6'][i % 4];
                return (
                  <div key={i} className="flex items-center gap-2">
                    <span className="w-16 truncate text-[10px] text-base-content/60">{s.labels.type ?? 'unknown'}</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-base-200">
                      <div className="h-full rounded-full transition-all"
                        style={{ width: `${Math.min((s.current / Math.max(llmTokens, 1)) * 100, 100)}%`, backgroundColor: col }} />
                    </div>
                    <span className="font-mono text-xs">{fmt(s.current)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          LAYER 3 — DEBUG: Why?
      ═══════════════════════════════════════════════════════════════════════ */}
      <div className="rounded-2xl border border-base-200 bg-base-100/50 p-4">
        <div className="mb-3 flex items-center gap-2">
          <div className="h-px flex-1 bg-gradient-to-r from-base-300 to-transparent" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-base-content/30">
            Layer 3 · Debug — ¿Por qué?
          </span>
          <div className="h-px flex-1 bg-gradient-to-l from-base-300 to-transparent" />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">

          {/* LLM Latency — Golden Signal: Latency */}
          <div className="rounded-xl border border-base-200 bg-base-100 p-4">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-sm font-semibold">LLM Latency</span>
              <span className="text-[10px] text-base-content/30">Golden Signal: Latency · avg 15m</span>
            </div>
            <div className="mb-3 flex gap-2 text-[9px] text-base-content/30">
              <span>▓ p50</span><span>▓▓ p95</span><span>▓▓▓ p99</span>
            </div>
            <GoldenLatency series={llmLatency} thresholds={{ warn: 1.0, crit: 2.0 }} />
          </div>

          {/* Saturation — Golden Signal: Saturation */}
          <div className="rounded-xl border border-base-200 bg-base-100 p-4">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-sm font-semibold">Saturation — Memoria</span>
              <span className="text-[10px] text-base-content/30">Golden Signal: Saturation</span>
            </div>
            <div className="mb-3 text-xs text-base-content/40">% de límite de contenedor</div>
            <div className="mb-4 space-y-3">
              <GoldenSaturation label="RSS" current={memRss} limit={memRssLimit} />
              <GoldenSaturation label="Heap usado" current={memHeap} limit={memHeapLimit} color="#8b5cf6" />
            </div>
            {memRssPts.length >= 2 && (
              <div>
                <div className="mb-1 text-[9px] text-base-content/30">RSS trend · {tr}</div>
                <Sparkline pts={memRssPts} color="#3b82f6" h={32} />
              </div>
            )}
          </div>

          {/* Error Rate — Golden Signal: Errors */}
          <div className="rounded-xl border border-base-200 bg-base-100 p-4">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-sm font-semibold">LLM Error Rate</span>
              <span className="text-[10px] text-base-content/30">Golden Signal: Errors · ratio sobre tráfico</span>
            </div>
            <GoldenErrorRate series={errorRates} />
          </div>

          {/* Throughput */}
          <div className="rounded-xl border border-base-200 bg-base-100 p-4">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-sm font-semibold">Requests LLM · Throughput</span>
              <span className="text-[10px] text-base-content/30">Golden Signal: Traffic · {tr}</span>
            </div>
            <div className="mt-3">
              <div className="mb-2 flex items-end justify-between">
                <span className="font-mono text-2xl font-black">{fmt(requestsRate.total)}</span>
                <span className="text-xs text-base-content/40">requests en {tr}</span>
              </div>
              {requestsRate.pts.length >= 2 && (
                <div className="rounded-lg bg-base-200/50 p-2">
                  <Sparkline pts={requestsRate.pts} color="#10b981" h={40} />
                </div>
              )}
            </div>
          </div>

        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          RECORDING RULES REFERENCE
      ═══════════════════════════════════════════════════════════════════════ */}
      <RulesRef />

      {/* ── VM UI link ──────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-dashed border-base-300 bg-base-100 p-4 text-center">
        <p className="text-sm text-base-content/50">
          Exploración avanzada:{' '}
          <a href="http://localhost:8428" target="_blank" rel="noopener noreferrer"
            className="link link-primary font-medium">
            VictoriaMetrics VMUI (:8428)
          </a>
          {' '}· Prometheus API en{' '}
          <code className="text-xs">/api/vm/query</code>
        </p>
      </div>

    </div>
  );
}
