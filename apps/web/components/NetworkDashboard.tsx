'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth/client';
import { useConnectors } from '@/lib/connectors/client';
import {
  ChartBarSquareIcon,
  CpuChipIcon,
  ServerStackIcon,
  SignalIcon,
  WifiIcon,
} from './icons';

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
    online: { label: 'En línea', className: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300' },
    offline: { label: 'Fuera de línea', className: 'border-rose-400/20 bg-rose-400/10 text-rose-300' },
    degraded: { label: 'Degradada', className: 'border-amber-400/20 bg-amber-400/10 text-amber-300' },
  };
  const selected = meta[status] ?? {
    label: status,
    className: 'border-neutral-700 text-neutral-300',
  };
  return <span className={`badge border ${selected.className}`}>{selected.label}</span>;
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
    return (
      <div role="status" aria-live="polite" className="grid animate-pulse grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => <div key={index} className="card h-28" />)}
        <span className="sr-only">Cargando datos de la red…</span>
      </div>
    );
  }
  if (setupNeeded) {
    return <div role="status" className="card px-5 py-8 text-center text-sm text-neutral-300">Conectá y validá un NMS para ver el tablero de tu red.</div>;
  }
  if (error) {
    return (
      <div role="alert" aria-live="assertive" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-danger/25 bg-danger/[0.07] px-4 py-3 text-sm text-red-200">
        <span>{error}</span>
        <button type="button" onClick={() => void load()} className="btn-outline">Reintentar</button>
      </div>
    );
  }
  if (!data) return null;

  const { dataSource, overview, olts, statusDistribution } = data;
  const totalForDistribution = Math.max(overview.totalOnus, 1);

  return (
    <div className="space-y-5">
      <div className="card-soft flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
        <div className="flex items-center gap-3">
          <span className={`relative flex h-2.5 w-2.5 rounded-full ${dataSource.mode === 'demo' ? 'bg-amber-400' : 'bg-emerald-400'}`}>
            <span className="absolute inset-0 animate-ping rounded-full bg-current opacity-35" />
          </span>
          <div>
            <p className="text-xs font-semibold text-white">{dataSource.mode === 'demo' ? 'Datos simulados' : 'Datos reales'} · {dataSource.label}</p>
            <p className="mt-0.5 text-[11px] text-neutral-500">Última lectura del NMS seleccionado</p>
          </div>
        </div>
        <button type="button" onClick={() => void load()} className="btn-outline">Actualizar datos</button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="OLTs" value={overview.totalOlts} sub={`${overview.oltsOnline} en línea`} Icon={ServerStackIcon} accent="cyan" />
        <StatCard label="ONUs totales" value={overview.totalOnus} sub={`${overview.onusOnline} operativas`} Icon={WifiIcon} accent="indigo" />
        <StatCard label="Fuera de línea" value={overview.onusOffline} sub="Requieren revisión" Icon={SignalIcon} accent="danger" />
        <StatCard label="Disponibilidad prom." value={formatUptime(overview.averageUptimeSeconds)} sub="Tiempo en servicio" Icon={ChartBarSquareIcon} accent="success" />
      </div>

      <section className="card p-5 sm:p-6">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-400/10 text-cyan-300 ring-1 ring-inset ring-cyan-300/15"><ChartBarSquareIcon className="h-4 w-4" /></span>
          <div>
            <h2 className="text-sm font-semibold text-white">Distribución de ONUs</h2>
            <p className="mt-0.5 text-xs text-neutral-500">Estado actual sobre {overview.totalOnus.toLocaleString('es-AR')} unidades</p>
          </div>
        </div>
        <div className="mt-6 flex h-3 overflow-hidden rounded-full bg-white/[0.04]" aria-label="Distribución de estados">
          {statusDistribution.online > 0 && <div className="bg-emerald-400" style={{ width: `${(statusDistribution.online / totalForDistribution) * 100}%` }} title={`${statusDistribution.online} en línea`} />}
          {statusDistribution.degraded > 0 && <div className="bg-amber-400" style={{ width: `${(statusDistribution.degraded / totalForDistribution) * 100}%` }} title={`${statusDistribution.degraded} degradadas`} />}
          {statusDistribution.offline > 0 && <div className="bg-rose-400" style={{ width: `${(statusDistribution.offline / totalForDistribution) * 100}%` }} title={`${statusDistribution.offline} fuera de línea`} />}
        </div>
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-neutral-400">
          <Legend color="bg-emerald-400" label={`En línea (${statusDistribution.online})`} />
          <Legend color="bg-amber-400" label={`Degradadas (${statusDistribution.degraded})`} />
          <Legend color="bg-rose-400" label={`Fuera de línea (${statusDistribution.offline})`} />
        </div>
      </section>

      <section className="card overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-5 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-400/10 text-indigo-300 ring-1 ring-inset ring-indigo-300/15"><CpuChipIcon className="h-4 w-4" /></span>
            <div><h2 className="text-sm font-semibold text-white">OLTs</h2><p className="mt-0.5 text-xs text-neutral-500">Detalle de infraestructura y capacidad</p></div>
          </div>
          <span className="badge border border-white/[0.08] bg-white/[0.035] text-neutral-400">{olts.length} equipos</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.06] bg-black/10 text-left text-[10px] uppercase tracking-[0.12em] text-neutral-500">
                <th scope="col" className="px-5 py-3 font-semibold sm:px-6">OLT</th>
                <th scope="col" className="px-4 py-3 font-semibold">Fabricante</th>
                <th scope="col" className="px-4 py-3 font-semibold">Temperatura</th>
                <th scope="col" className="px-4 py-3 font-semibold">Disponibilidad</th>
                <th scope="col" className="px-4 py-3 font-semibold">Estado</th>
                <th scope="col" className="px-5 py-3 font-semibold sm:px-6">ONUs</th>
              </tr>
            </thead>
            <tbody>
              {olts.map((olt) => (
                <tr key={olt.id} className="border-b border-white/[0.05] text-neutral-300 transition-colors last:border-0 hover:bg-white/[0.025]">
                  <td className="px-5 py-3.5 sm:px-6"><div className="font-semibold text-white">{olt.name}</div><div className="mt-0.5 font-mono text-[10px] text-neutral-500">{olt.id}</div></td>
                  <td className="px-4 py-3.5 text-xs">{olt.vendor ?? '—'}</td>
                  <td className="px-4 py-3.5 text-xs"><span className={(olt.temperatureCelsius ?? 0) > 60 ? 'font-semibold text-rose-300' : ''}>{olt.temperatureCelsius ?? '—'}{olt.temperatureCelsius !== undefined ? ' °C' : ''}</span></td>
                  <td className="px-4 py-3.5 text-xs">{olt.uptimeSeconds ? formatUptime(olt.uptimeSeconds) : '—'}</td>
                  <td className="px-4 py-3.5"><StatusBadge status={olt.status} /></td>
                  <td className="px-5 py-3.5 text-xs sm:px-6"><span className="text-emerald-300">{olt.onusOnline}</span>{' / '}<span className="text-rose-300">{olt.onusOffline}</span>{' / '}<span className="text-amber-300">{olt.onusDegraded}</span></td>
                </tr>
              ))}
              {olts.length === 0 && <tr><td colSpan={6} className="px-6 py-10 text-center text-sm text-neutral-400">No hay OLTs para mostrar.</td></tr>}
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

function StatCard({ label, value, sub, Icon, accent }: { label: string; value: number | string; sub: string; Icon: React.ComponentType<{ className?: string }>; accent: 'cyan' | 'indigo' | 'danger' | 'success' }) {
  const styles = {
    cyan: 'bg-cyan-400/10 text-cyan-300 ring-cyan-300/15',
    indigo: 'bg-indigo-400/10 text-indigo-300 ring-indigo-300/15',
    danger: 'bg-rose-400/10 text-rose-300 ring-rose-300/15',
    success: 'bg-emerald-400/10 text-emerald-300 ring-emerald-300/15',
  }[accent];
  return (
    <div className="card p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div><p className="text-[11px] font-medium text-neutral-500">{label}</p><p className={`mt-2 text-2xl font-semibold tracking-[-0.04em] sm:text-3xl ${accent === 'danger' ? 'text-rose-200' : 'text-white'}`}>{typeof value === 'number' ? value.toLocaleString('es-AR') : value}</p></div>
        <span className={`flex h-9 w-9 items-center justify-center rounded-xl ring-1 ring-inset ${styles}`}><Icon className="h-4 w-4" /></span>
      </div>
      <p className="mt-3 text-[11px] text-neutral-500">{sub}</p>
    </div>
  );
}
