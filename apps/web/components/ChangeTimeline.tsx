'use client';

import { useCallback, useEffect, useState } from 'react';

type TimelineEventKind = 'alert' | 'incident' | 'device_event' | 'change_event' | 'confirmed_incident';

interface TimelineEvent {
  id: string; kind: TimelineEventKind; category: string;
  deviceKind: string | null; deviceId: string | null;
  title: string; severity: string; timestamp: string;
  message: string | null; correlatedIds?: string[]; runbookId?: string | null; resolutionMs?: number | null;
}

interface TimelineResponse {
  timeline: TimelineEvent[];
  summary: { total: number; byKind: Record<string, number>; lookbackHours: number };
}

const KIND_ICON: Record<TimelineEventKind, string> = {
  alert: '⚠', incident: '🚨', device_event: '📡',
  change_event: '🔧', confirmed_incident: '✅',
};
const KIND_COLOR: Record<TimelineEventKind, string> = {
  alert: '#f59e0b', incident: '#ef4444', device_event: '#6b7280',
  change_event: '#3b82f6', confirmed_incident: '#10b981',
};

function fmtDur(ms: number) {
  const s = ms / 1000;
  return s >= 86400 ? `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`
    : s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
    : s >= 60 ? `${Math.floor(s / 60)}m`
    : `${Math.floor(s)}s`;
}

function fmtAge(ts: string) {
  const diff = Date.now() - new Date(ts).getTime();
  return fmtDur(diff) + ' ago';
}

export function ChangeTimeline() {
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [summary, setSummary] = useState<TimelineResponse['summary'] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hours, setHours] = useState(48);
  const [kindFilter, setKindFilter] = useState<string>('');

  const fetchTimeline = useCallback(async () => {
     
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams({ hours: String(hours), limit: '150' });
      if (kindFilter) params.set('kind', kindFilter);
      const r = await fetch(`/api/ops/events?${params}`, { credentials: 'include' });
      if (!r.ok) throw new Error(await r.text());
      const data: TimelineResponse = await r.json();
      setTimeline(data.timeline ?? []);
      setSummary(data.summary ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
       
      setLoading(false);
    }
  }, [hours, kindFilter]);

  useEffect(() => {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void fetchTimeline(); }, [fetchTimeline]);

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold">Timeline de cambios</h3>
          <p className="text-xs text-base-content/40">Alerts · incidents · syslog · cambios confirmados · ventana {hours}h</p>
        </div>
        <div className="flex items-center gap-2">
          <select className="select select-xs select-bordered" value={kindFilter} onChange={e => setKindFilter(e.target.value)}>
            <option value="">Todos</option>
            <option value="alert">Alerts</option>
            <option value="incident">Incidents</option>
            <option value="device_event">Syslog/Traps</option>
            <option value="change_event">Cambios</option>
            <option value="confirmed_incident">Confirmados</option>
          </select>
          <select className="select select-xs select-bordered" value={hours} onChange={e => setHours(Number(e.target.value))}>
            <option value={6}>6h</option><option value={12}>12h</option>
            <option value={24}>24h</option><option value={48}>48h</option><option value={168}>7d</option>
          </select>
          <button className={`btn btn-xs btn-ghost ${loading ? 'loading' : ''}`} onClick={() => void fetchTimeline()} disabled={loading}>↻</button>
        </div>
      </div>

      {/* Summary */}
      {summary && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(summary.byKind).filter(([, n]) => n > 0).map(([k, n]) => (
            <span key={k} className="badge badge-sm badge-outline" style={{ color: KIND_COLOR[k as TimelineEventKind] ?? '#6b7280', borderColor: KIND_COLOR[k as TimelineEventKind] ?? '#6b7280' }}>
              {KIND_ICON[k as TimelineEventKind] ?? '◽'} {n} {k.replace('_', ' ')}
            </span>
          ))}
        </div>
      )}

      {error && <div className="alert alert-error py-2 text-xs">{error}</div>}

      {/* Timeline */}
      {timeline.length === 0 && !loading && (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <span className="text-2xl">📋</span>
          <p className="text-sm text-base-content/50">Sin eventos en esta ventana</p>
        </div>
      )}

      <div className="relative">
        {/* Vertical line */}
        <div className="absolute left-4 top-0 bottom-0 w-px bg-base-200" />

        <div className="space-y-1.5">
          {timeline.slice(0, 60).map((ev) => {
            const icon = KIND_ICON[ev.kind] ?? '◽';
            const col = KIND_COLOR[ev.kind] ?? '#6b7280';
            const isCrit = ev.severity === 'critical';

            return (
              <div key={ev.id} className="relative flex items-start gap-3 pl-10">
                {/* Dot */}
                <div className="absolute left-2.5 top-2.5 z-10 flex h-5 w-5 items-center justify-center rounded-full border-2"
                  style={{ borderColor: col, backgroundColor: isCrit ? col : 'var(--color-base-100)' }}>
                  <span className="text-[8px]" style={{ color: col }}>{icon}</span>
                </div>

                <div className="flex-1 min-w-0 rounded-lg border border-base-200 bg-base-100 p-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="badge badge-xs" style={{ backgroundColor: col + '20', color: col }}>
                          {ev.kind.replace('_', ' ')}
                        </span>
                        {ev.deviceKind && <span className="text-[10px] text-base-content/50">{ev.deviceKind}</span>}
                        {ev.deviceId && <span className="font-mono text-[10px] text-base-content/40 truncate">{ev.deviceId}</span>}
                      </div>
                      <div className="mt-0.5 truncate text-xs font-medium" style={{ color: isCrit ? col : undefined }}>
                        {ev.title}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="font-mono text-[9px] text-base-content/40">{fmtAge(ev.timestamp)}</div>
                      {ev.resolutionMs != null && (
                        <div className="font-mono text-[9px] text-success">MTTR: {fmtDur(ev.resolutionMs)}</div>
                      )}
                    </div>
                  </div>
                  {ev.message && (
                    <div className="mt-1 truncate text-[10px] text-base-content/40">{ev.message}</div>
                  )}
                  {ev.correlatedIds && ev.correlatedIds.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      <span className="text-[9px] text-base-content/30">Correlacionado:</span>
                      {ev.correlatedIds.slice(0, 3).map(id => (
                        <span key={id} className="rounded bg-base-200 px-1 font-mono text-[9px] text-base-content/50">{id}</span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {timeline.length > 60 && (
          <div className="relative pl-20 py-2 text-center">
            <span className="text-xs text-base-content/30">+{timeline.length - 60} eventos más</span>
          </div>
        )}
      </div>
    </div>
  );
}
