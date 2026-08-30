'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth/client';
import { ServerStackIcon } from './icons';

interface Incident {
  id: string;
  deviceKind: string;
  deviceId: string;
  title: string;
  description: string;
  severity: 'warning' | 'critical';
  status: 'open' | 'acknowledged' | 'resolved';
  firstSeenAt: string;
  lastSeenAt: string;
  alertCount: number;
}

export function IncidentsPanel() {
  const auth = useAuth();
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!auth.user) return;
    setLoading(true);
    try {
      const response = await fetch('/api/incidents', { credentials: 'include' });
      const body = await response.json().catch(() => ({}));
      setIncidents(body.incidents ?? []);
    } catch {
      // noop — a failed incidents read should never block the dashboard
    } finally {
      setLoading(false);
    }
  }, [auth.user]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  if (!auth.user) return null;
  if (!loading && incidents.length === 0) return null;

  return (
    <section className="card overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-5 py-4 sm:px-6">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-400/10 text-rose-300 ring-1 ring-inset ring-rose-300/15">
            <ServerStackIcon className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-white">Incidentes correlacionados</h2>
            <p className="mt-0.5 text-xs text-neutral-500">Alertas agrupadas por equipo</p>
          </div>
        </div>
        <span className="badge border border-white/[0.08] bg-white/[0.035] text-neutral-400">
          {incidents.length} incidente{incidents.length === 1 ? '' : 's'}
        </span>
      </div>

      {loading ? (
        <p className="px-6 py-4 text-xs text-neutral-500">Cargando incidentes…</p>
      ) : (
        <ul className="divide-y divide-white/[0.05]">
          {incidents.map((incident) => {
            const critical = incident.severity === 'critical';
            return (
              <li key={incident.id} className="flex items-start gap-3 px-5 py-3.5 sm:px-6">
                <span
                  className={`mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ring-1 ring-inset ${
                    critical
                      ? 'bg-rose-400/10 text-rose-300 ring-rose-300/20'
                      : 'bg-amber-400/10 text-amber-300 ring-amber-300/20'
                  }`}
                >
                  <ServerStackIcon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="text-sm font-medium text-white">{incident.title}</span>
                    <span className="badge border border-white/[0.08] bg-white/[0.035] text-neutral-400">
                      {incident.alertCount} alerta{incident.alertCount === 1 ? '' : 's'}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs leading-relaxed text-neutral-400">{incident.description}</p>
                  <div className="mt-1 text-[11px] text-neutral-500">
                    <span className="font-mono">{incident.deviceKind} · {incident.deviceId}</span>
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
