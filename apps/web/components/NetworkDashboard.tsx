'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth/client';
import { useConnectors } from '@/lib/connectors/client';

interface OltWithStats {
  id: string;
  name: string;
  status: string;
  temperatureCelsius?: number;
  uptimeSeconds?: number;
  vendor?: string;
  onusOnline: number;
  onusOffline: number;
  onusDegraded: number;
}

interface DashboardData {
  dataSource: { mode: 'live' | 'demo'; provider: string; label: string };
  overview: {
    totalOlts: number;
    oltsOnline: number;
    totalOnus: number;
    onusOnline: number;
    onusOffline: number;
    averageUptimeSeconds: number;
  };
  olts: OltWithStats[];
  statusDistribution: { online: number; offline: number; degraded: number };
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  return days > 0 ? `${days} d ${hours} h` : `${hours} h`;
}

function StatusBadge({ status }: { status: string }) {
  const meta: Record<string, { label: string; className: string }> = {
    online: { label: 'En línea', className: 'border-green-800 bg-green-900/50 text-green-300' },
    offline: { label: 'Fuera de línea', className: 'border-red-800 bg-red-900/50 text-red-300' },
    degraded: { label: 'Degradada', className: 'border-yellow-800 bg-yellow-900/50 text-yellow-300' },
  };
  const selected = meta[status] ?? {
    label: status,
    className: 'border-neutral-700 text-neutral-300',
  };
  return <span className={`rounded border px-2 py-0.5 text-xs ${selected.className}`}>{selected.label}</span>;
}

export default function NetworkDashboard() {
  const auth = useAuth();
  const connectorState = useConnectors();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [setupNeeded, setSetupNeeded] = useState(false);

  const load = useCallback(async () => {
    if (!auth.user) return;
    setLoading(true);
    setError(null);
    setSetupNeeded(false);
    try {
      const query = connectorState.selectedConnectionId
        ? `?connectionId=${encodeURIComponent(connectorState.selectedConnectionId)}`
        : '';
      const response = await fetch(`/api/dashboard${query}`, { credentials: 'include' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 409) {
          setSetupNeeded(true);
          setData(null);
          return;
        }
        throw new Error(body.error ?? `No se pudo cargar el tablero (${response.status}).`);
      }
      setData(body as DashboardData);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se pudo cargar el tablero.');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [auth.user, connectorState.selectedConnectionId]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  if (auth.loading || !auth.user) return null;

  if (loading) {
    return <p role="status" aria-live="polite" className="mt-6 text-sm text-neutral-300">Cargando datos de la red…</p>;
  }
  if (setupNeeded) {
    return <div role="status" className="card mt-6 px-5 py-4 text-sm text-neutral-300">Conectá y validá un NMS para ver el tablero de tu red.</div>;
  }
  if (error) {
    return (
      <div role="alert" aria-live="assertive" className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-800 bg-red-950/30 px-4 py-3 text-sm text-red-300">
        <span>{error}</span>
        <button type="button" onClick={() => void load()} className="btn-outline">Reintentar</button>
      </div>
    );
  }
  if (!data) return null;

  const { dataSource, overview, olts, statusDistribution } = data;
  const totalForDistribution = Math.max(overview.totalOnus, 1);

  return (
    <div className="mt-6 space-y-6">
      <div className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm ${dataSource.mode === 'demo' ? 'border-yellow-800 bg-yellow-950/30 text-yellow-300' : 'border-green-800 bg-green-950/30 text-green-300'}`}>
        <span>{dataSource.mode === 'demo' ? 'Datos simulados' : 'Datos reales'} · {dataSource.label}</span>
        <button type="button" onClick={() => void load()} className="btn-outline">Actualizar</button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="OLTs" value={overview.totalOlts} sub={`${overview.oltsOnline} en línea`} />
        <StatCard label="ONUs" value={overview.totalOnus} sub={`${overview.onusOnline} en línea`} />
        <StatCard label="Fuera de línea" value={overview.onusOffline} sub="ONUs caídas" danger />
        <StatCard label="Disponibilidad prom." value={formatUptime(overview.averageUptimeSeconds)} sub="de la red" />
      </div>

      <section className="card p-4">
        <h3 className="mb-2 text-xs font-medium uppercase text-neutral-300">Distribución del estado de las ONUs</h3>
        <div className="flex h-6 overflow-hidden rounded-full" aria-label="Distribución de estados">
          {statusDistribution.online > 0 && <div className="flex items-center justify-center bg-green-600 text-xs text-white" style={{ width: `${(statusDistribution.online / totalForDistribution) * 100}%` }}>{statusDistribution.online}</div>}
          {statusDistribution.degraded > 0 && <div className="flex items-center justify-center bg-yellow-500 text-xs text-neutral-950" style={{ width: `${(statusDistribution.degraded / totalForDistribution) * 100}%` }}>{statusDistribution.degraded}</div>}
          {statusDistribution.offline > 0 && <div className="flex items-center justify-center bg-red-600 text-xs text-white" style={{ width: `${(statusDistribution.offline / totalForDistribution) * 100}%` }}>{statusDistribution.offline}</div>}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-300">
          <Legend color="bg-green-600" label={`En línea (${statusDistribution.online})`} />
          <Legend color="bg-yellow-500" label={`Degradadas (${statusDistribution.degraded})`} />
          <Legend color="bg-red-600" label={`Fuera de línea (${statusDistribution.offline})`} />
        </div>
      </section>

      <section className="card p-4">
        <h3 className="mb-3 text-xs font-medium uppercase text-neutral-300">OLTs</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-neutral-800 text-left text-neutral-300">
                <th scope="col" className="pb-2 pr-4">OLT</th>
                <th scope="col" className="pb-2 pr-4">Fabricante</th>
                <th scope="col" className="pb-2 pr-4">Temperatura</th>
                <th scope="col" className="pb-2 pr-4">Disponibilidad</th>
                <th scope="col" className="pb-2 pr-4">Estado</th>
                <th scope="col" className="pb-2">ONUs</th>
              </tr>
            </thead>
            <tbody>
              {olts.map((olt) => (
                <tr key={olt.id} className="border-b border-neutral-800/50">
                  <td className="py-2 pr-4"><div className="font-medium">{olt.name}</div><div className="text-neutral-300">{olt.id}</div></td>
                  <td className="py-2 pr-4">{olt.vendor ?? '—'}</td>
                  <td className="py-2 pr-4"><span className={(olt.temperatureCelsius ?? 0) > 60 ? 'text-red-300' : ''}>{olt.temperatureCelsius ?? '—'}{olt.temperatureCelsius !== undefined ? ' °C' : ''}</span></td>
                  <td className="py-2 pr-4">{olt.uptimeSeconds ? formatUptime(olt.uptimeSeconds) : '—'}</td>
                  <td className="py-2 pr-4"><StatusBadge status={olt.status} /></td>
                  <td className="py-2"><span className="text-green-300">{olt.onusOnline}</span>{' / '}<span className="text-red-300">{olt.onusOffline}</span>{' / '}<span className="text-yellow-300">{olt.onusDegraded}</span></td>
                </tr>
              ))}
              {olts.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-neutral-300">No hay OLTs para mostrar.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return <span className="flex items-center gap-1"><span aria-hidden="true" className={`inline-block h-2 w-2 rounded-full ${color}`} />{label}</span>;
}

function StatCard({ label, value, sub, danger }: { label: string; value: number | string; sub: string; danger?: boolean }) {
  return <div className="card p-3"><div className="text-xs text-neutral-300">{label}</div><div className={`mt-1 text-2xl font-semibold ${danger ? 'text-red-300' : 'text-neutral-50'}`}>{value}</div><div className="text-xs text-neutral-300">{sub}</div></div>;
}
