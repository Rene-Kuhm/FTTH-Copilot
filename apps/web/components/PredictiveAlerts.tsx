'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth/client';
import { BellIcon, ExclamationTriangleIcon } from './icons';

interface Prediction {
  id: string;
  kind: string;
  severity: 'warning' | 'critical';
  deviceKind: string;
  deviceId: string;
  title: string;
  description: string;
  etaMs: number | null;
  confidence: number | null;
  firstSeenAt: string;
  lastSeenAt: string;
}

const KIND_LABEL: Record<string, string> = {
  predicted_low_signal: 'Señal en caída',
  predicted_high_temperature: 'Temperatura en ascenso',
  intermittent_connection: 'Conexión intermitente',
  frequent_reboots: 'Reinicios repetidos',
  metric_anomaly: 'Anomalía de métrica',
};

function formatEta(etaMs: number | null): string {
  if (etaMs === null || etaMs === undefined) return '';
  const hours = etaMs / 3_600_000;
  if (hours < 24) return `~${Math.max(1, Math.round(hours))} h`;
  return `~${(hours / 24).toFixed(1)} días`;
}

export function PredictiveAlerts() {
  const auth = useAuth();
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!auth.user) return;
    setLoading(true);
    try {
      const response = await fetch('/api/predictions', { credentials: 'include' });
      const body = await response.json().catch(() => ({}));
      setPredictions(body.predictions ?? []);
    } catch {
      // noop — a failed predictions read should never block the dashboard
    } finally {
      setLoading(false);
    }
  }, [auth.user]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  if (!auth.user) return null;
  if (!loading && predictions.length === 0) return null;

  return (
    <section className="card overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-5 py-4 sm:px-6">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-400/10 text-amber-300 ring-1 ring-inset ring-amber-300/15">
            <BellIcon className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-white">Fallas pronosticadas</h2>
            <p className="mt-0.5 text-xs text-neutral-500">Detección temprana · antes del impacto</p>
          </div>
        </div>
        <span className="badge border border-white/[0.08] bg-white/[0.035] text-neutral-400">
          {predictions.length} alerta{predictions.length === 1 ? '' : 's'}
        </span>
      </div>

      {loading ? (
        <p className="px-6 py-4 text-xs text-neutral-500">Cargando predicciones…</p>
      ) : (
        <ul className="divide-y divide-white/[0.05]">
          {predictions.map((prediction) => {
            const critical = prediction.severity === 'critical';
            const eta = formatEta(prediction.etaMs);
            return (
              <li key={prediction.id} className="flex items-start gap-3 px-5 py-3.5 sm:px-6">
                <span
                  className={`mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ring-1 ring-inset ${
                    critical
                      ? 'bg-rose-400/10 text-rose-300 ring-rose-300/20'
                      : 'bg-amber-400/10 text-amber-300 ring-amber-300/20'
                  }`}
                >
                  <ExclamationTriangleIcon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="text-sm font-medium text-white">{prediction.title}</span>
                    <span className="badge border border-white/[0.08] bg-white/[0.035] text-neutral-400">
                      {KIND_LABEL[prediction.kind] ?? prediction.kind}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs leading-relaxed text-neutral-400">{prediction.description}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-neutral-500">
                    <span className="font-mono">{prediction.deviceKind} · {prediction.deviceId}</span>
                    {eta && <span className="text-amber-300">ETA {eta}</span>}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
