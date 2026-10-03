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
  const meta: Record<string, { label: string; style: React.CSSProperties }> = {
    online: {
      label: 'En línea',
      style: {
        background: 'color-mix(in srgb, var(--color-success) 12%, transparent)',
        color: 'var(--color-success)',
        border: '1px solid color-mix(in srgb, var(--color-success) 30%, transparent)',
      },
    },
    offline: {
      label: 'Fuera de línea',
      style: {
        background: 'color-mix(in srgb, var(--color-danger) 12%, transparent)',
        color: 'var(--color-danger)',
        border: '1px solid color-mix(in srgb, var(--color-danger) 30%, transparent)',
      },
    },
    degraded: {
      label: 'Degradada',
      style: {
        background: 'color-mix(in srgb, var(--color-warning) 12%, transparent)',
        color: 'var(--color-warning)',
        border: '1px solid color-mix(in srgb, var(--color-warning) 30%, transparent)',
      },
    },
  };
  const selected = meta[status] ?? {
    label: status,
    style: {
      background: 'color-mix(in srgb, var(--color-muted) 12%, transparent)',
      color: 'var(--color-muted)',
      border: '1px solid var(--border-divider)',
    },
  };
  return (
    <span
      className="badge"
      style={{ fontFamily: 'var(--font-display)', borderRadius: 'var(--radius-pill)', ...selected.style }}
    >
      {selected.label}
    </span>
  );
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
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="card h-28" />
        ))}
        <span className="sr-only">Cargando datos de la red…</span>
      </div>
    );
  }
  if (setupNeeded) {
    return (
      <div
        role="status"
        className="card px-5 py-8 text-center text-sm"
        style={{ color: 'var(--color-muted)' }}
      >
        Conectá y validá un NMS para ver el tablero de tu red.
      </div>
    );
  }
  if (error) {
    return (
      <div
        role="alert"
        aria-live="assertive"
        className="flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3 text-sm"
        style={{
          border: '1px solid color-mix(in srgb, var(--color-danger) 30%, transparent)',
          background: 'color-mix(in srgb, var(--color-danger) 8%, transparent)',
          color: 'var(--color-text)',
        }}
      >
        <span>{error}</span>
        <button type="button" onClick={() => void load()} className="btn-outline">
          Reintentar
        </button>
      </div>
    );
  }
  if (!data) return null;

  const { dataSource, overview, olts, statusDistribution } = data;
  const totalForDistribution = Math.max(overview.totalOnus, 1);

  return (
    <div className="space-y-5">
      {/* Data source bar */}
      <div
        className="card-soft flex flex-wrap items-center justify-between gap-3 px-4 py-3.5"
        style={{ color: 'var(--color-text)' }}
      >
        <div className="flex items-center gap-3">
          <span
            className="relative flex h-2.5 w-2.5 rounded-full"
            style={{
              background: dataSource.mode === 'demo' ? 'var(--color-warning)' : 'var(--color-success)',
            }}
          >
            <span
              className="absolute inset-0 rounded-full opacity-35"
              style={{
                background: 'currentColor',
                animation: 'ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite',
              }}
            />
          </span>
          <div>
            <p
              className="text-xs font-semibold"
              style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text)' }}
            >
              {dataSource.mode === 'demo' ? 'Datos simulados' : 'Datos reales'} ·{' '}
              {dataSource.label}
            </p>
            <p className="mt-0.5 text-[11px]" style={{ color: 'var(--color-muted)' }}>
              Última lectura del NMS seleccionado
            </p>
          </div>
        </div>
        <button type="button" onClick={() => void load()} className="btn-outline">
          Actualizar datos
        </button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="OLTs"
          value={overview.totalOlts}
          sub={`${overview.oltsOnline} en línea`}
          Icon={ServerStackIcon}
          accent="accent"
        />
        <StatCard
          label="ONUs totales"
          value={overview.totalOnus}
          sub={`${overview.onusOnline} operativas`}
          Icon={WifiIcon}
          accent="accent"
        />
        <StatCard
          label="Fuera de línea"
          value={overview.onusOffline}
          sub="Requieren revisión"
          Icon={SignalIcon}
          accent="danger"
        />
        <StatCard
          label="Disponibilidad prom."
          value={formatUptime(overview.averageUptimeSeconds)}
          sub="Tiempo en servicio"
          Icon={ChartBarSquareIcon}
          accent="success"
        />
      </div>

      {/* ONU distribution */}
      <section className="card p-5 sm:p-6" style={{ color: 'var(--color-text)' }}>
        <div className="flex items-center gap-3">
          <span
            className="flex h-9 w-9 items-center justify-center rounded-xl"
            style={{
              background: 'rgb(242 48 119 / 0.1)',
              border: '1px solid color-mix(in srgb, var(--color-accent) 25%, transparent)',
              color: 'var(--color-accent)',
            }}
          >
            <ChartBarSquareIcon className="h-4 w-4" />
          </span>
          <div>
            <h2
              className="text-sm font-semibold"
              style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text)' }}
            >
              Distribución de ONUs
            </h2>
            <p className="mt-0.5 text-xs" style={{ color: 'var(--color-muted)' }}>
              Estado actual sobre {overview.totalOnus.toLocaleString('es-AR')} unidades
            </p>
          </div>
        </div>

        {/* Bar */}
        <div
          className="mt-6 flex h-3 overflow-hidden rounded-full"
          style={{ background: 'color-mix(in srgb, var(--color-muted) 15%, transparent)' }}
          aria-label="Distribución de estados"
        >
          {statusDistribution.online > 0 && (
            <div
              style={{
                width: `${(statusDistribution.online / totalForDistribution) * 100}%`,
                background: 'var(--color-success)',
              }}
              title={`${statusDistribution.online} en línea`}
            />
          )}
          {statusDistribution.degraded > 0 && (
            <div
              style={{
                width: `${(statusDistribution.degraded / totalForDistribution) * 100}%`,
                background: 'var(--color-warning)',
              }}
              title={`${statusDistribution.degraded} degradadas`}
            />
          )}
          {statusDistribution.offline > 0 && (
            <div
              style={{
                width: `${(statusDistribution.offline / totalForDistribution) * 100}%`,
                background: 'var(--color-danger)',
              }}
              title={`${statusDistribution.offline} fuera de línea`}
            />
          )}
        </div>

        {/* Legend */}
        <div
          className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs"
          style={{ color: 'var(--color-muted)' }}
        >
          <Legend color="var(--color-success)" label={`En línea (${statusDistribution.online})`} />
          <Legend color="var(--color-warning)" label={`Degradadas (${statusDistribution.degraded})`} />
          <Legend color="var(--color-danger)" label={`Fuera de línea (${statusDistribution.offline})`} />
        </div>
      </section>

      {/* OLT table */}
      <section className="card overflow-hidden" style={{ color: 'var(--color-text)' }}>
        <div
          className="flex items-center justify-between gap-3 border-b px-5 py-4 sm:px-6"
          style={{ borderColor: 'var(--border-divider)' }}
        >
          <div className="flex items-center gap-3">
            <span
              className="flex h-9 w-9 items-center justify-center rounded-xl"
              style={{
                background: 'color-mix(in srgb, var(--color-accent) 10%, transparent)',
                border: '1px solid color-mix(in srgb, var(--color-accent) 25%, transparent)',
                color: 'var(--color-accent)',
              }}
            >
              <CpuChipIcon className="h-4 w-4" />
            </span>
            <div>
              <h2
                className="text-sm font-semibold"
                style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text)' }}
              >
                OLTs
              </h2>
              <p className="mt-0.5 text-xs" style={{ color: 'var(--color-muted)' }}>
                Detalle de infraestructura y capacidad
              </p>
            </div>
          </div>
          <span
            className="badge"
            style={{
              background: 'color-mix(in srgb, var(--color-muted) 10%, transparent)',
              color: 'var(--color-muted)',
              border: '1px solid var(--border-divider)',
              fontFamily: 'var(--font-display)',
            }}
          >
            {olts.length} equipos
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr
                className="border-b text-left text-[10px] uppercase tracking-[0.12em]"
                style={{ borderColor: 'var(--border-divider)', color: 'var(--color-muted)' }}
              >
                <th scope="col" className="px-5 py-3 font-semibold sm:px-6" style={{ fontFamily: 'var(--font-display)' }}>OLT</th>
                <th scope="col" className="px-4 py-3 font-semibold" style={{ fontFamily: 'var(--font-display)' }}>Fabricante</th>
                <th scope="col" className="px-4 py-3 font-semibold" style={{ fontFamily: 'var(--font-display)' }}>Temperatura</th>
                <th scope="col" className="px-4 py-3 font-semibold" style={{ fontFamily: 'var(--font-display)' }}>Disponibilidad</th>
                <th scope="col" className="px-4 py-3 font-semibold" style={{ fontFamily: 'var(--font-display)' }}>Estado</th>
                <th scope="col" className="px-5 py-3 font-semibold sm:px-6" style={{ fontFamily: 'var(--font-display)' }}>ONUs</th>
              </tr>
            </thead>
            <tbody>
              {olts.map((olt) => (
                <tr
                  key={olt.id}
                  className="border-b last:border-0"
                  style={{
                    borderColor: 'color-mix(in srgb, var(--color-muted) 20%, transparent)',
                    color: 'color-mix(in srgb, var(--color-text) 85%, var(--color-muted))',
                    transition: 'background-color 180ms ease',
                  }}
                >
                  <td className="px-5 py-3.5 sm:px-6">
                    <div className="font-semibold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text)' }}>
                      {olt.name}
                    </div>
                    <div
                      className="mt-0.5 text-[10px]"
                      style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-muted)' }}
                    >
                      {olt.id}
                    </div>
                  </td>
                  <td className="px-4 py-3.5 text-xs">{olt.vendor ?? '—'}</td>
                  <td className="px-4 py-3.5 text-xs">
                    <span
                      style={
                        (olt.temperatureCelsius ?? 0) > 60
                          ? { color: 'var(--color-danger)', fontWeight: 600 }
                          : {}
                      }
                    >
                      {olt.temperatureCelsius ?? '—'}
                      {olt.temperatureCelsius !== undefined ? ' °C' : ''}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-xs">
                    {olt.uptimeSeconds ? formatUptime(olt.uptimeSeconds) : '—'}
                  </td>
                  <td className="px-4 py-3.5"><StatusBadge status={olt.status} /></td>
                  <td className="px-5 py-3.5 text-xs sm:px-6">
                    <span style={{ color: 'var(--color-success)' }}>{olt.onusOnline}</span>
                    {' / '}
                    <span style={{ color: 'var(--color-danger)' }}>{olt.onusOffline}</span>
                    {' / '}
                    <span style={{ color: 'var(--color-warning)' }}>{olt.onusDegraded}</span>
                  </td>
                </tr>
              ))}
              {olts.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-10 text-center text-sm" style={{ color: 'var(--color-muted)' }}>
                    No hay OLTs para mostrar.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        aria-hidden="true"
        className="inline-block h-2 w-2 rounded-full"
        style={{ background: color }}
      />
      {label}
    </span>
  );
}

function StatCard({
  label,
  value,
  sub,
  Icon,
  accent,
}: {
  label: string;
  value: number | string;
  sub: string;
  Icon: React.ComponentType<{ className?: string }>;
  accent: 'accent' | 'success' | 'danger';
}) {
  const accentStyles = {
    accent: {
      bg: 'rgb(242 48 119 / 0.1)',
      border: 'color-mix(in srgb, var(--color-accent) 25%, transparent)',
      text: 'var(--color-accent)',
    },
    success: {
      bg: 'color-mix(in srgb, var(--color-success) 10%, transparent)',
      border: 'color-mix(in srgb, var(--color-success) 25%, transparent)',
      text: 'var(--color-success)',
    },
    danger: {
      bg: 'color-mix(in srgb, var(--color-danger) 10%, transparent)',
      border: 'color-mix(in srgb, var(--color-danger) 25%, transparent)',
      text: 'var(--color-danger)',
    },
  }[accent];

  return (
    <div className="card p-4 sm:p-5" style={{ color: 'var(--color-text)' }}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p
            className="text-[11px] font-medium"
            style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-display)' }}
          >
            {label}
          </p>
          <p
            className="mt-2 text-2xl font-semibold tracking-[-0.04em] sm:text-3xl"
            style={{
              fontFamily: 'var(--font-display)',
              color: accent === 'danger' ? 'var(--color-danger)' : 'var(--color-text)',
            }}
          >
            {typeof value === 'number' ? value.toLocaleString('es-AR') : value}
          </p>
        </div>
        <span
          className="flex h-9 w-9 items-center justify-center rounded-xl"
          style={{
            background: accentStyles.bg,
            border: `1px solid ${accentStyles.border}`,
            color: accentStyles.text,
          }}
        >
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className="mt-3 text-[11px]" style={{ color: 'var(--color-muted)' }}>
        {sub}
      </p>
    </div>
  );
}
