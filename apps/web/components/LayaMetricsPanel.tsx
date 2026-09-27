'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth/client';
import { hasPermission } from '@/lib/auth/permissions';
import { SparklesIcon, ChartBarSquareIcon, Cog6ToothIcon, KeyIcon } from './icons';

// ── Laya Decision Layer metrics panel (ADR-042) ───────────────────────────────
//
// Fetches and parses Prometheus exposition format from /api/metrics,
// extracting the ftth_laya_* metrics families for display.
//
// Metrics exposed:
//   ftth_laya_requests_total{mode, event_class, result}  — decision counts
//   ftth_laya_latency_ms{mode, quantile}                — p50/p95/p99 latency
//   ftth_laya_confidence{event_class, stat}             — avg/min/max confidence

interface LayaMetrics {
  requests: Record<string, number>;
  latency: Record<string, { p50: number; p95: number; p99: number }>;
  confidence: Record<string, { avg: number; min: number; max: number }>;
  lastUpdated: Date | null;
  error?: string;
}

type RefreshState = 'idle' | 'loading';

function parseMetrics(text: string): LayaMetrics {
  const metrics: LayaMetrics = {
    requests: {},
    latency: {},
    confidence: {},
    lastUpdated: new Date(),
  };

  for (const line of text.split('\n')) {
    // ftth_laya_requests_total{mode="shadow",event_class="OPTICAL_FAULT",result="success"} 42
    const reqMatch = line.match(
      /^ftth_laya_requests_total\{([^}]+)\}\s+(\d+(\.\d+)?)$/
    );
    if (reqMatch) {
      const labels = reqMatch[1];
      const value = parseInt(reqMatch[2], 10);
      const modeMatch = labels.match(/mode="([^"]+)"/);
      const classMatch = labels.match(/event_class="([^"]+)"/);
      const mode = modeMatch?.[1] ?? 'unknown';
      const eventClass = classMatch?.[1] ?? 'unknown';
      const key = `${mode}__${eventClass}`;
      metrics.requests[key] = (metrics.requests[key] ?? 0) + value;
    }

    // ftth_laya_latency_ms{mode="shadow",quantile="p50"} 1.23
    const latMatch = line.match(
      /^ftth_laya_latency_ms\{([^}]+)\}\s+(\d+(\.\d+)?)$/
    );
    if (latMatch) {
      const labels = latMatch[1];
      const value = parseFloat(latMatch[2]);
      const modeMatch = labels.match(/mode="([^"]+)"/);
      const quantileMatch = labels.match(/quantile="([^"]+)"/);
      const mode = modeMatch?.[1] ?? 'unknown';
      const quantile = quantileMatch?.[1] ?? 'p50';
      if (!metrics.latency[mode]) {
        metrics.latency[mode] = { p50: 0, p95: 0, p99: 0 };
      }
      if (quantile === 'p50') metrics.latency[mode].p50 = value;
      if (quantile === 'p95') metrics.latency[mode].p95 = value;
      if (quantile === 'p99') metrics.latency[mode].p99 = value;
    }

    // ftth_laya_confidence{event_class="CONGESTION",stat="avg"} 0.950
    const confMatch = line.match(
      /^ftth_laya_confidence\{([^}]+)\}\s+(\d+(\.\d+)?)$/
    );
    if (confMatch) {
      const labels = confMatch[1];
      const value = parseFloat(confMatch[2]);
      const classMatch = labels.match(/event_class="([^"]+)"/);
      const statMatch = labels.match(/stat="([^"]+)"/);
      const eventClass = classMatch?.[1] ?? 'unknown';
      const stat = statMatch?.[1] ?? 'avg';
      if (!metrics.confidence[eventClass]) {
        metrics.confidence[eventClass] = { avg: 0, min: 0, max: 0 };
      }
      if (stat === 'avg') metrics.confidence[eventClass].avg = value;
      if (stat === 'min') metrics.confidence[eventClass].min = value;
      if (stat === 'max') metrics.confidence[eventClass].max = value;
    }
  }

  return metrics;
}

function LatencyCard({
  mode,
  stats,
}: {
  mode: string;
  stats: { p50: number; p95: number; p99: number };
}) {
  const formatMs = (v: number) =>
    v < 1 ? `${(v * 1000).toFixed(0)}µs` : `${v.toFixed(1)}ms`;

  return (
    <div className="rounded-lg border border-base-200 bg-base-100 p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium">{mode}</span>
        <span className="badge badge-sm">{mode}</span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <div className="text-xs text-base-content/60">p50</div>
          <div className="font-mono text-sm font-semibold">{formatMs(stats.p50)}</div>
        </div>
        <div>
          <div className="text-xs text-base-content/60">p95</div>
          <div className="font-mono text-sm font-semibold">{formatMs(stats.p95)}</div>
        </div>
        <div>
          <div className="text-xs text-base-content/60">p99</div>
          <div className="font-mono text-sm font-semibold">{formatMs(stats.p99)}</div>
        </div>
      </div>
    </div>
  );
}

function ConfidenceBar({
  eventClass,
  stats,
}: {
  eventClass: string;
  stats: { avg: number; min: number; max: number };
}) {
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  const hasData = stats.avg > 0;

  return (
    <div className="flex items-center justify-between gap-4 border-b border-base-200 py-2 last:border-0">
      <span className="min-w-0 flex-1 truncate font-mono text-xs">{eventClass}</span>
      <div className="flex items-center gap-3">
        <div className="h-1.5 w-24 overflow-hidden rounded-full bg-base-200">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: hasData ? `${stats.avg * 100}%` : '0%' }}
          />
        </div>
        <span className="w-14 text-right font-mono text-xs text-base-content/60">
          {hasData ? pct(stats.avg) : '—'}
        </span>
        <span className="w-14 text-right font-mono text-xs text-base-content/40">
          {hasData ? `[${pct(stats.min)}–${pct(stats.max)}]` : '—'}
        </span>
      </div>
    </div>
  );
}

export function LayaMetricsPanel() {
  const auth = useAuth();
  const [metrics, setMetrics] = useState<LayaMetrics>({
    requests: {},
    latency: {},
    confidence: {},
    lastUpdated: null,
  });
  const [refreshState, setRefreshState] = useState<RefreshState>('idle');

  const canView = auth.user ? hasPermission(auth.user.role, 'view_network') : false;

  const fetchMetrics = useCallback(async () => {
    if (!canView) return;
    setRefreshState('loading');
    try {
      const res = await fetch('/api/metrics');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      setMetrics(parseMetrics(text));
    } catch (err) {
      setMetrics((prev) => ({
        ...prev,
        error: err instanceof Error ? err.message : 'Fetch failed',
      }));
    } finally {
      setRefreshState('idle');
    }
  }, [canView]);

  useEffect(() => {
    void fetchMetrics();
    const interval = setInterval(() => void fetchMetrics(), 30_000);
    return () => clearInterval(interval);
  }, [fetchMetrics]);

  if (!canView) return null;

  const totalDecisions = Object.values(metrics.requests).reduce(
    (sum, v) => sum + v,
    0
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Laya — Decision Layer</h2>
          <p className="text-sm text-base-content/60">
            Expert System · ADR-042 · shadow mode
            {metrics.lastUpdated && (
              <span className="ml-2">
                · actualizado {metrics.lastUpdated.toLocaleTimeString('es-ES')}
              </span>
            )}
          </p>
        </div>
        <button
          className="btn btn-ghost btn-sm gap-1"
          onClick={() => void fetchMetrics()}
          disabled={refreshState === 'loading'}
        >
          <Cog6ToothIcon
            className={`h-4 w-4 ${refreshState === 'loading' ? 'animate-spin' : ''}`}
          />
          Refresh
        </button>
      </div>

      {metrics.error && (
        <div className="alert alert-error">
          <span>Error fetching metrics: {metrics.error}</span>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-lg border border-base-200 bg-base-100 p-4">
          <div className="flex items-center gap-2 text-sm text-base-content/60">
            <SparklesIcon className="h-4 w-4" />
            Decisiones
          </div>
          <div className="mt-1 font-mono text-2xl font-bold">
            {totalDecisions.toLocaleString('es-ES')}
          </div>
        </div>

        {Object.entries(metrics.latency).map(([mode, stats]) => (
          <LatencyCard key={mode} mode={mode} stats={stats} />
        ))}

        {Object.keys(metrics.latency).length === 0 && (
          <div className="col-span-2 rounded-lg border border-base-200 bg-base-100 p-4 text-center text-sm text-base-content/40">
            Sin datos de latencia aún
          </div>
        )}
      </div>

      {/* Confidence by event class */}
      {Object.keys(metrics.confidence).length > 0 && (
        <div className="rounded-lg border border-base-200 bg-base-100 p-4">
          <div className="mb-3 flex items-center gap-2">
            <ChartBarSquareIcon className="h-4 w-4 text-base-content/60" />
            <span className="text-sm font-medium">Confianza por clase de evento</span>
          </div>
          {Object.entries(metrics.confidence).map(([eventClass, stats]) => (
            <ConfidenceBar key={eventClass} eventClass={eventClass} stats={stats} />
          ))}
        </div>
      )}

      {/* Decision counts by mode */}
      {Object.keys(metrics.requests).length > 0 && (
        <div className="rounded-lg border border-base-200 bg-base-100 p-4">
          <div className="mb-3 flex items-center gap-2">
            <KeyIcon className="h-4 w-4 text-base-content/60" />
            <span className="text-sm font-medium">Decisiones por modo y clase</span>
          </div>
          <div className="overflow-x-auto">
            <table className="table table-sm">
              <thead>
                <tr>
                  <th>Modo</th>
                  <th>Clase de evento</th>
                  <th className="text-right">Decisiones</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(metrics.requests)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([key, count]) => {
                    const [mode, eventClass] = key.split('__');
                    return (
                      <tr key={key}>
                        <td>
                          <span className="badge badge-sm">{mode}</span>
                        </td>
                        <td>
                          <code className="text-xs">{eventClass}</code>
                        </td>
                        <td className="text-right font-mono">{count}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {Object.keys(metrics.requests).length === 0 &&
        Object.keys(metrics.confidence).length === 0 &&
        !metrics.error && (
          <div className="rounded-lg border border-base-200 bg-base-100 p-8 text-center text-base-content/40">
            <SparklesIcon className="mx-auto mb-2 h-8 w-8 opacity-30" />
            <p className="text-sm">Sin decisiones registradas aún.</p>
            <p className="mt-1 text-xs">
              Activa Laya con <code>LAYA_ENABLED=true</code> y{' '}
              <code>LAYA_MODE=shadow</code> para comenzar a registrar.
            </p>
          </div>
        )}
    </div>
  );
}
