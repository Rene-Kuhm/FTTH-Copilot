'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth/client';
import { useConnectors } from '@/lib/connectors/client';
import {
  BellIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  XCircleIcon,
} from './icons';

interface Alert {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  category: string;
  title: string;
  description: string;
  affectedEntity: string;
  detectedAt: string;
}

const SEVERITY_STYLE: Record<
  Alert['severity'],
  {
    label: string;
    chip: React.CSSProperties;
    row: React.CSSProperties;
    Icon: React.ComponentType<{ className?: string }>;
  }
> = {
  critical: {
    label: 'Crítica',
    chip: {
      background: 'color-mix(in srgb, var(--color-danger) 15%, transparent)',
      color: 'var(--color-danger)',
      border: '1px solid color-mix(in srgb, var(--color-danger) 30%, transparent)',
      borderRadius: 'var(--radius-pill)',
      padding: '0.2rem 0.55rem',
      fontSize: '0.6875rem',
      fontWeight: 650,
      fontFamily: 'var(--font-display)',
      display: 'inline-flex',
      alignItems: 'center',
      gap: '0.3rem',
    },
    row: {
      background: 'color-mix(in srgb, var(--color-danger) 5%, transparent)',
      border: '1px solid color-mix(in srgb, var(--color-danger) 25%, transparent)',
      borderRadius: 'var(--radius-card)',
      padding: '0.875rem 0.875rem',
      transition: 'all 180ms ease',
    },
    Icon: XCircleIcon,
  },
  warning: {
    label: 'Advertencia',
    chip: {
      background: 'color-mix(in srgb, var(--color-warning) 15%, transparent)',
      color: 'var(--color-warning)',
      border: '1px solid color-mix(in srgb, var(--color-warning) 30%, transparent)',
      borderRadius: 'var(--radius-pill)',
      padding: '0.2rem 0.55rem',
      fontSize: '0.6875rem',
      fontWeight: 650,
      fontFamily: 'var(--font-display)',
      display: 'inline-flex',
      alignItems: 'center',
      gap: '0.3rem',
    },
    row: {
      background: 'color-mix(in srgb, var(--color-warning) 5%, transparent)',
      border: '1px solid color-mix(in srgb, var(--color-warning) 25%, transparent)',
      borderRadius: 'var(--radius-card)',
      padding: '0.875rem 0.875rem',
      transition: 'all 180ms ease',
    },
    Icon: ExclamationTriangleIcon,
  },
  info: {
    label: 'Información',
    chip: {
      background: 'rgb(242 48 119 / 0.12)',
      color: 'var(--color-accent)',
      border: '1px solid color-mix(in srgb, var(--color-accent) 30%, transparent)',
      borderRadius: 'var(--radius-pill)',
      padding: '0.2rem 0.55rem',
      fontSize: '0.6875rem',
      fontWeight: 650,
      fontFamily: 'var(--font-display)',
      display: 'inline-flex',
      alignItems: 'center',
      gap: '0.3rem',
    },
    row: {
      background: 'rgb(242 48 119 / 0.04)',
      border: '1px solid color-mix(in srgb, var(--color-accent) 20%, transparent)',
      borderRadius: 'var(--radius-card)',
      padding: '0.875rem 0.875rem',
      transition: 'all 180ms ease',
    },
    Icon: InformationCircleIcon,
  },
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diff) || diff < 0) return '';
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'ahora';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return `hace ${d} d`;
}

function formatCategory(c: string): string {
  const translated: Record<string, string> = {
    connectivity: 'Conectividad',
    temperature: 'Temperatura',
    signal: 'Señal',
    low_signal: 'Señal baja',
    availability: 'Disponibilidad',
    performance: 'Rendimiento',
  };
  if (translated[c.toLowerCase()]) return translated[c.toLowerCase()];
  return c.replace(/[_-]+/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}

export function AlertsPanel() {
  const auth = useAuth();
  const connectorState = useConnectors();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dataSource, setDataSource] = useState<{
    mode: 'live' | 'demo';
    label: string;
  } | null>(null);
  const [expanded, setExpanded] = useState(true);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());

  const load = useCallback(async () => {
    if (!auth.user) return;
    setLoading(true);
    setError(null);
    try {
      const query = connectorState.selectedConnectionId
        ? `?connectionId=${encodeURIComponent(connectorState.selectedConnectionId)}`
        : '';
      const response = await fetch(`/api/alerts${query}`, { credentials: 'include' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 409) {
          setAlerts([]);
          setDataSource(null);
          return;
        }
        throw new Error(data.error ?? `No se pudieron cargar las alertas (${response.status}).`);
      }
      setAlerts(data.alerts ?? []);
      setDataSource(data.dataSource ?? null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudieron cargar las alertas.');
    } finally {
      setLoading(false);
    }
  }, [auth.user, connectorState.selectedConnectionId]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  const counts = useMemo(() => {
    return alerts.reduce(
      (acc, a) => {
        acc[a.severity] = (acc[a.severity] ?? 0) + 1;
        return acc;
      },
      { critical: 0, warning: 0, info: 0 } as Record<Alert['severity'], number>,
    );
  }, [alerts]);

  const groups = useMemo(() => {
    const map = new Map<string, Alert[]>();
    for (const a of alerts) {
      const list = map.get(a.category) ?? [];
      list.push(a);
      map.set(a.category, list);
    }
    const order: Alert['severity'][] = ['critical', 'warning', 'info'];
    return Array.from(map.entries())
      .map(([category, items]) => {
        items.sort(
          (a, b) =>
            order.indexOf(a.severity) - order.indexOf(b.severity) ||
            new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime(),
        );
        const topSeverity =
          items.find((i) => i.severity === 'critical') ??
          items.find((i) => i.severity === 'warning') ??
          items[0];
        return { category, items, topSeverity };
      })
      .sort((a, b) => {
        const ai = order.indexOf(a.topSeverity.severity);
        const bi = order.indexOf(b.topSeverity.severity);
        if (ai !== bi) return ai - bi;
        return a.category.localeCompare(b.category);
      });
  }, [alerts]);

  if (auth.loading || !auth.user) return null;

  if (loading) {
    return (
      <div role="status" aria-live="polite" className="card h-28 animate-pulse">
        <span className="sr-only">Cargando alertas…</span>
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

  if (alerts.length === 0) {
    return (
      <section className="card flex flex-col items-center px-5 py-8 text-center sm:px-6">
        <span
          className="flex h-12 w-12 items-center justify-center rounded-2xl"
          style={{
            background: 'color-mix(in srgb, var(--color-success) 10%, transparent)',
            border: '1px solid color-mix(in srgb, var(--color-success) 25%, transparent)',
            color: 'var(--color-success)',
          }}
        >
          <BellIcon className="h-5 w-5" />
        </span>
        <h2
          className="mt-4 text-sm font-semibold"
          style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text)' }}
        >
          {connectorState.connectedConnectors.length === 0 && !dataSource
            ? 'Conectá tu primera red'
            : 'Sin alertas activas'}
        </h2>
        <p
          className="mt-1.5 max-w-sm text-xs leading-5"
          style={{ color: 'var(--color-muted)' }}
        >
          {connectorState.connectedConnectors.length === 0 && !dataSource
            ? 'Validá un NMS para empezar a consultar eventos operativos.'
            : `No hay eventos que requieran atención${dataSource ? ` en ${dataSource.label}` : ''}.`}
        </p>
        <button type="button" onClick={() => void load()} className="btn-outline mt-4">
          Actualizar alertas
        </button>
      </section>
    );
  }

  function toggleGroup(category: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }

  return (
    <section className="card overflow-hidden" style={{ color: 'var(--color-text)' }}>
      {/* Demo mode banner */}
      {dataSource?.mode === 'demo' && (
        <div
          className="border-b px-5 py-2 text-xs"
          style={{
            borderColor: 'color-mix(in srgb, var(--color-warning) 25%, transparent)',
            background: 'color-mix(in srgb, var(--color-warning) 7%, transparent)',
            color: 'var(--color-warning)',
            fontFamily: 'var(--font-display)',
          }}
        >
          Datos simulados · {dataSource.label}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-2 px-3 sm:px-5">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center justify-between gap-4 py-4 text-left"
          style={{ color: 'var(--color-text)' }}
        >
          <div className="flex items-center gap-3">
            <span
              className="flex h-10 w-10 items-center justify-center rounded-xl"
              style={{
                background: 'color-mix(in srgb, var(--color-warning) 10%, transparent)',
                border: '1px solid color-mix(in srgb, var(--color-warning) 25%, transparent)',
                color: 'var(--color-warning)',
              }}
            >
              <BellIcon className="h-5 w-5" />
            </span>
            <div>
              <h2
                className="text-sm font-semibold"
                style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text)' }}
              >
                Alertas de red
              </h2>
              <p className="mt-0.5 text-xs" style={{ color: 'var(--color-muted)' }}>
                {alerts.length} alerta{alerts.length === 1 ? '' : 's'} activa
                {alerts.length === 1 ? '' : 's'} · agrupadas por categoría
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {counts.critical > 0 && (
              <span style={SEVERITY_STYLE.critical.chip}>
                <XCircleIcon className="h-3.5 w-3.5" />
                {counts.critical} crítica{counts.critical === 1 ? '' : 's'}
              </span>
            )}
            {counts.warning > 0 && (
              <span style={SEVERITY_STYLE.warning.chip}>
                <ExclamationTriangleIcon className="h-3.5 w-3.5" />
                {counts.warning} advertencia{counts.warning === 1 ? '' : 's'}
              </span>
            )}
            <ChevronDownIcon
              className="h-4 w-4 transition-transform"
              style={{
                color: 'var(--color-muted)',
                transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)',
              }}
            />
          </div>
        </button>
        <button type="button" onClick={() => void load()} className="btn-outline">
          Actualizar
        </button>
      </div>

      {/* Alert groups */}
      {expanded && (
        <div
          className="divide-y"
          style={{ borderTop: '1px solid var(--border-divider)', borderColor: 'var(--border-divider)' }}
        >
          {groups.map(({ category, items, topSeverity }) => {
            const collapsed = collapsedGroups.has(category);
            const { Icon } = SEVERITY_STYLE[topSeverity.severity];
            return (
              <div key={category}>
                <button
                  type="button"
                  onClick={() => void toggleGroup(category)}
                  aria-expanded={!collapsed}
                  className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left"
                  style={{
                    fontFamily: 'var(--font-display)',
                    transition: 'background-color 180ms ease',
                  }}
                >
                  <div className="flex items-center gap-2.5">
                    <span style={{ color: 'var(--color-muted)' }}>
                      {collapsed ? (
                        <ChevronRightIcon className="h-4 w-4" />
                      ) : (
                        <ChevronDownIcon className="h-4 w-4" />
                      )}
                    </span>
                    <span style={{ color: SEVERITY_STYLE[topSeverity.severity].chip.color as string }}>
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="font-medium" style={{ color: 'var(--color-text)' }}>
                      {formatCategory(category)}
                    </span>
                    <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
                      ({items.length})
                    </span>
                  </div>
                </button>

                {!collapsed && (
                  <ul className="space-y-2 px-5 pb-4">
                    {items.map((alert) => {
                      const meta = SEVERITY_STYLE[alert.severity];
                      const AlertIcon = meta.Icon;
                      return (
                        <li key={alert.id} style={meta.row}>
                          <div className="flex items-start gap-3">
                            <span className="mt-0.5 flex-shrink-0" style={{ color: meta.chip.color as string }}>
                              <AlertIcon className="h-4 w-4" />
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                                <span
                                  className="text-sm font-medium"
                                  style={{ color: 'var(--color-text)' }}
                                >
                                  {alert.title}
                                </span>
                                <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
                                  {alert.affectedEntity}
                                </span>
                              </div>
                              <p
                                className="mt-0.5 text-xs leading-relaxed"
                                style={{ color: 'var(--color-muted)' }}
                              >
                                {alert.description}
                              </p>
                            </div>
                            <span className="flex-shrink-0 text-xs" style={{ color: 'var(--color-muted)' }}>
                              {timeAgo(alert.detectedAt)}
                            </span>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
