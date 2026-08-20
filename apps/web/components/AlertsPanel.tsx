'use client';

import { useEffect, useState } from 'react';

interface Alert {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  category: string;
  title: string;
  description: string;
  affectedEntity: string;
  detectedAt: string;
}

const SEVERITY_STYLES: Record<string, string> = {
  critical: 'border-red-800 bg-red-950/30',
  warning: 'border-yellow-800 bg-yellow-950/30',
  info: 'border-blue-800 bg-blue-950/30',
};

const SEVERITY_DOT: Record<string, string> = {
  critical: 'bg-red-500',
  warning: 'bg-yellow-500',
  info: 'bg-blue-500',
};

export function AlertsPanel() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    queueMicrotask(() => {
      fetch('/api/alerts', { credentials: 'include' })
        .then(r => r.json())
        .then(data => setAlerts(data.alerts ?? []))
        .catch(() => {})
        .finally(() => setLoading(false));
    });
  }, []);

  if (loading) return null;
  if (alerts.length === 0) return null;

  const critical = alerts.filter(a => a.severity === 'critical').length;
  const warning = alerts.filter(a => a.severity === 'warning').length;

  return (
    <div className="rounded-md border border-neutral-800 bg-bg-subtle p-3">
      <button onClick={() => setExpanded(!expanded)} className="flex w-full items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium uppercase text-fg-muted">Alertas de Red</span>
          <span className="rounded bg-red-900/50 px-1.5 py-0.5 text-xs text-red-400">{critical} crit.</span>
          <span className="rounded bg-yellow-900/50 px-1.5 py-0.5 text-xs text-yellow-400">{warning} adv.</span>
        </div>
        <span className="text-xs text-fg-muted">{expanded ? '▲' : '▼'}</span>
      </button>
      {expanded && (
        <div className="mt-2 space-y-1.5">
          {alerts.map(alert => (
            <div key={alert.id} className={`flex items-start gap-2 rounded border px-2 py-1.5 text-xs ${SEVERITY_STYLES[alert.severity]}`}>
              <span className={`mt-1 inline-block h-2 w-2 flex-shrink-0 rounded-full ${SEVERITY_DOT[alert.severity]}`} />
              <div className="min-w-0 flex-1">
                <div className="font-medium">{alert.title}</div>
                <div className="text-fg-muted">{alert.description}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
