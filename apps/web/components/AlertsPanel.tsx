'use client';

import { useEffect, useMemo, useState } from 'react';
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

const SEVERITY_META: Record<
  Alert['severity'],
  {
    label: string;
    chipClass: string;
    rowClass: string;
    Icon: React.ComponentType<{ className?: string }>;
  }
> = {
  critical: {
    label: 'Critical',
    chipClass: 'bg-danger/15 text-red-500 ring-1 ring-inset ring-danger/30',
    rowClass:
      'border-danger/30 bg-danger/5 hover:border-danger/50 hover:bg-red-500/10',
    Icon: XCircleIcon,
  },
  warning: {
    label: 'Warning',
    chipClass:
      'bg-warning/15 text-amber-500 ring-1 ring-inset ring-warning/30',
    rowClass:
      'border-warning/30 bg-warning/5 hover:border-warning/50 hover:bg-warning/10',
    Icon: ExclamationTriangleIcon,
  },
  info: {
    label: 'Info',
    chipClass:
      'bg-blue-500/15 text-blue-500 ring-1 ring-inset ring-blue-500/30',
    rowClass:
      'border-blue-500/30 bg-blue-500/5 hover:border-blue-500/50 hover:bg-blue-500/10',
    Icon: InformationCircleIcon,
  },
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diff) || diff < 0) return '';
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function formatCategory(c: string): string {
  return c
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

export function AlertsPanel() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(true);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    () => new Set(),
  );

  useEffect(() => {
    queueMicrotask(() => {
      fetch('/api/alerts', { credentials: 'include' })
        .then((r) => r.json())
        .then((data) => setAlerts(data.alerts ?? []))
        .catch(() => {})
        .finally(() => setLoading(false));
    });
  }, []);

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

  if (loading) return null;
  if (alerts.length === 0) return null;

  function toggleGroup(category: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }

  return (
    <section className="card overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-neutral-800/30"
      >
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-warning/10 text-amber-500 ring-1 ring-inset ring-warning/30">
            <BellIcon className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-neutral-50">Network Alerts</h2>
            <p className="mt-0.5 text-xs text-neutral-500">
              {alerts.length} active alert{alerts.length === 1 ? '' : 's'} ·
              grouped by category
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {counts.critical > 0 && (
            <span className={SEVERITY_META.critical.chipClass + ' badge'}>
              <XCircleIcon className="h-3.5 w-3.5" />
              {counts.critical} critical
            </span>
          )}
          {counts.warning > 0 && (
            <span className={SEVERITY_META.warning.chipClass + ' badge'}>
              <ExclamationTriangleIcon className="h-3.5 w-3.5" />
              {counts.warning} warning
            </span>
          )}
          <ChevronDownIcon
            className={`h-4 w-4 text-neutral-500 transition-transform ${
              expanded ? '' : '-rotate-90'
            }`}
          />
        </div>
      </button>

      {expanded && (
        <div className="border-t border-neutral-800 divide-y divide-neutral-800/70">
          {groups.map(({ category, items, topSeverity }) => {
            const collapsed = collapsedGroups.has(category);
            const Icon = SEVERITY_META[topSeverity.severity].Icon;
            return (
              <div key={category}>
                <button
                  type="button"
                  onClick={() => void toggleGroup(category)}
                  aria-expanded={!collapsed}
                  className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left text-sm transition-colors hover:bg-neutral-800/30"
                >
                  <div className="flex items-center gap-2.5">
                    {collapsed ? (
                      <ChevronRightIcon className="h-4 w-4 text-neutral-500" />
                    ) : (
                      <ChevronDownIcon className="h-4 w-4 text-neutral-500" />
                    )}
                    <Icon
                      className={`h-4 w-4 ${
                        SEVERITY_META[topSeverity.severity].chipClass.split(
                          ' ',
                        )[1] ?? 'text-neutral-400'
                      }`}
                    />
                    <span className="font-medium text-neutral-50">
                      {formatCategory(category)}
                    </span>
                    <span className="text-xs text-neutral-500">
                      ({items.length})
                    </span>
                  </div>
                </button>

                {!collapsed && (
                  <ul className="space-y-2 px-5 pb-4">
                    {items.map((alert) => {
                      const meta = SEVERITY_META[alert.severity];
                      const AlertIcon = meta.Icon;
                      return (
                        <li
                          key={alert.id}
                          className={`rounded-lg border px-3.5 py-2.5 transition-colors ${meta.rowClass}`}
                        >
                          <div className="flex items-start gap-3">
                            <AlertIcon className="mt-0.5 h-4 w-4 flex-shrink-0" />
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                                <span className="text-sm font-medium text-neutral-50">
                                  {alert.title}
                                </span>
                                <span className="text-xs text-neutral-500">
                                  {alert.affectedEntity}
                                </span>
                              </div>
                              <p className="mt-0.5 text-xs leading-relaxed text-neutral-400">
                                {alert.description}
                              </p>
                            </div>
                            <span className="flex-shrink-0 text-xs text-neutral-500">
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
