'use client';

import { useEffect, useState } from 'react';

interface OltWithStats {
  id: string;
  name: string;
  ip: string;
  status: string;
  temperatureCelsius?: number;
  uptimeSeconds?: number;
  location?: string;
  vendor?: string;
  onusTotal: number;
  onusOnline: number;
  onusOffline: number;
  onusDegraded: number;
}

interface DashboardData {
  overview: {
    totalOlts: number;
    oltsOnline: number;
    totalOnus: number;
    onusOnline: number;
    onusOffline: number;
    averageUptimeSeconds: number;
    oltsWithHighTemperature: number;
  };
  olts: OltWithStats[];
  statusDistribution: { online: number; offline: number; degraded: number };
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  if (days > 0) return `${days}d ${hours}h`;
  return `${hours}h`;
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    online: 'bg-green-900/50 text-green-400 border-green-800',
    offline: 'bg-red-900/50 text-red-400 border-red-800',
    degraded: 'bg-yellow-900/50 text-yellow-400 border-yellow-800',
  };
  return (
    <span className={`rounded border px-2 py-0.5 text-xs ${colors[status] ?? 'border-neutral-700 text-fg-muted'}`}>
      {status}
    </span>
  );
}

export default function NetworkDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    queueMicrotask(() => {
      fetch('/api/dashboard', { credentials: 'include' })
        .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
        .then(setData)
        .catch(e => setError(e instanceof Error ? e.message : 'Error'))
        .finally(() => setLoading(false));
    });
  }, []);

  if (loading) return <p className="text-sm text-fg-muted">Cargando datos de la red…</p>;
  if (error) return <div className="rounded-md border border-red-800 bg-red-950/30 px-3 py-2 text-sm text-red-400">{error}</div>;
  if (!data) return null;

  const { overview, olts, statusDistribution } = data;

  return (
    <div className="space-y-6">
      {/* Stats cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="OLTs" value={overview.totalOlts} sub={`${overview.oltsOnline} online`} />
        <StatCard label="ONUs" value={overview.totalOnus} sub={`${overview.onusOnline} online`} />
        <StatCard label="Offline" value={overview.onusOffline} sub="ONUs caídas" danger />
        <StatCard label="Uptime prom." value={formatUptime(overview.averageUptimeSeconds)} sub="de la red" />
      </div>

      {/* Status distribution bar */}
      <div className="rounded-md border border-neutral-800 bg-bg-subtle p-4">
        <h3 className="mb-2 text-xs font-medium uppercase text-fg-muted">Distribucion de estado ONUs</h3>
        <div className="flex h-6 overflow-hidden rounded-full">
          {statusDistribution.online > 0 && (
            <div className="bg-green-600 flex items-center justify-center text-xs text-white" style={{ width: `${(statusDistribution.online / overview.totalOnus) * 100}%` }}>
              {statusDistribution.online}
            </div>
          )}
          {statusDistribution.degraded > 0 && (
            <div className="bg-yellow-500 flex items-center justify-center text-xs text-white" style={{ width: `${(statusDistribution.degraded / overview.totalOnus) * 100}%` }}>
              {statusDistribution.degraded}
            </div>
          )}
          {statusDistribution.offline > 0 && (
            <div className="bg-red-600 flex items-center justify-center text-xs text-white" style={{ width: `${(statusDistribution.offline / overview.totalOnus) * 100}%` }}>
              {statusDistribution.offline}
            </div>
          )}
        </div>
        <div className="mt-1 flex gap-4 text-xs text-fg-muted">
          <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-green-600" /> Online ({statusDistribution.online})</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-yellow-500" /> Degraded ({statusDistribution.degraded})</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-red-600" /> Offline ({statusDistribution.offline})</span>
        </div>
      </div>

      {/* OLTs table */}
      <div className="rounded-md border border-neutral-800 bg-bg-subtle p-4">
        <h3 className="mb-3 text-xs font-medium uppercase text-fg-muted">OLTs</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-neutral-800 text-left text-fg-muted">
                <th className="pb-2 pr-4">OLT</th>
                <th className="pb-2 pr-4">Vendor</th>
                <th className="pb-2 pr-4">Temp</th>
                <th className="pb-2 pr-4">Uptime</th>
                <th className="pb-2 pr-4">Estado</th>
                <th className="pb-2">ONUs</th>
              </tr>
            </thead>
            <tbody>
              {olts.map(olt => (
                <tr key={olt.id} className="border-b border-neutral-800/50">
                  <td className="py-2 pr-4">
                    <div className="font-medium">{olt.name}</div>
                    <div className="text-fg-muted">{olt.id}</div>
                  </td>
                  <td className="py-2 pr-4">{olt.vendor ?? '-'}</td>
                  <td className="py-2 pr-4">
                    <span className={(olt.temperatureCelsius ?? 0) > 60 ? 'text-red-400' : ''}>
                      {olt.temperatureCelsius ?? '-'}°C
                    </span>
                  </td>
                  <td className="py-2 pr-4">{olt.uptimeSeconds ? formatUptime(olt.uptimeSeconds) : '-'}</td>
                  <td className="py-2 pr-4"><StatusBadge status={olt.status} /></td>
                  <td className="py-2">
                    <span className="text-green-400">{olt.onusOnline}</span>
                    {' / '}
                    <span className="text-red-400">{olt.onusOffline}</span>
                    {' / '}
                    <span className="text-yellow-400">{olt.onusDegraded}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, danger }: { label: string; value: number | string; sub: string; danger?: boolean }) {
  return (
    <div className="rounded-md border border-neutral-800 bg-bg-subtle p-3">
      <div className="text-xs text-fg-muted">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${danger ? 'text-red-400' : 'text-fg'}`}>{value}</div>
      <div className="text-xs text-fg-muted">{sub}</div>
    </div>
  );
}
