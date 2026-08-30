'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth/client';
import { ChartBarSquareIcon } from './icons';

interface SlaEntry {
  deviceKind: string;
  deviceId: string;
  uptimePercent: number | null;
  offlineMs: number | null;
}

function formatUptime(percent: number | null): string {
  if (percent === null) return '—';
  return `${percent.toFixed(2)}%`;
}

function tone(percent: number): string {
  if (percent >= 99.9) return 'text-emerald-300';
  if (percent >= 99) return 'text-amber-300';
  return 'text-rose-300';
}

export function SlaPanel() {
  const auth = useAuth();
  const [sla, setSla] = useState<SlaEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!auth.user) return;
    setLoading(true);
    try {
      const response = await fetch('/api/sla', { credentials: 'include' });
      const body = await response.json().catch(() => ({}));
      setSla(body.sla ?? []);
    } catch {
      // noop
    } finally {
      setLoading(false);
    }
  }, [auth.user]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  if (!auth.user) return null;
  if (!loading && sla.length === 0) return null;

  return (
    <section className="card overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-5 py-4 sm:px-6">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-400/10 text-emerald-300 ring-1 ring-inset ring-emerald-300/15">
            <ChartBarSquareIcon className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-white">Uptime / SLA</h2>
            <p className="mt-0.5 text-xs text-neutral-500">Disponibilidad por equipo (30 días)</p>
          </div>
        </div>
        <span className="badge border border-white/[0.08] bg-white/[0.035] text-neutral-400">
          {sla.length} equipo{sla.length === 1 ? '' : 's'}
        </span>
      </div>

      {loading ? (
        <p className="px-6 py-4 text-xs text-neutral-500">Cargando uptime…</p>
      ) : (
        <ul className="divide-y divide-white/[0.05]">
          {sla.map((entry) => (
            <li key={`${entry.deviceKind}-${entry.deviceId}`} className="flex items-center justify-between gap-4 px-5 py-3 sm:px-6">
              <div className="min-w-0">
                <div className="text-sm font-medium text-white">{entry.deviceId}</div>
                <div className="text-[11px] text-neutral-500 font-mono">{entry.deviceKind}</div>
              </div>
              <span className={`text-sm font-semibold ${entry.uptimePercent === null ? 'text-neutral-500' : tone(entry.uptimePercent)}`}>
                {formatUptime(entry.uptimePercent)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
