'use client';

import { useCallback, useEffect, useState } from 'react';

interface Runbook {
  id: string; title: string; content: string;
  deviceKind: string | null; deviceId: string | null;
  alertKind: string | null; severity: string | null;
  tags: string[]; stepCount: number; useCount: number;
  lastUsedAt: string | null;
}
interface HistoryEntry {
  id: string; deviceKind: string; deviceId: string; severity: string;
  summary: string; rootCause: string | null; fix: string | null; observedAt: string;
}
interface RunbooksResponse { runbooks: Runbook[]; relatedHistory: HistoryEntry[] }

export function RunbookPanel() {
  const [runbooks, setRunbooks] = useState<Runbook[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filterKind, setFilterKind] = useState('');
  const [filterAlert, setFilterAlert] = useState('');

  const fetchRunbooks = useCallback(async () => {
    // Initialize state before async fetch (safe here — single update before await)
     
    setLoading(true);
     
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filterKind) params.set('deviceKind', filterKind);
      if (filterAlert) params.set('alertKind', filterAlert);
      const r = await fetch(`/api/ops/runbooks?${params}`, { credentials: 'include' });
      if (!r.ok) throw new Error(await r.text());
      const data: RunbooksResponse = await r.json();
      setRunbooks(data.runbooks ?? []);
      setHistory(data.relatedHistory ?? []);
      if (data.runbooks.length > 0 && !selectedId) setSelectedId(data.runbooks[0]!.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
       
      setLoading(false);
    }
  }, [filterKind, filterAlert, selectedId]);

  useEffect(() => {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void fetchRunbooks(); }, [fetchRunbooks]);

  const recordUse = useCallback(async (id: string) => {
    await fetch('/api/ops/runbooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
      credentials: 'include',
    });
  }, []);

  const selected = runbooks.find(r => r.id === selectedId);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold">Runbooks</h3>
          <p className="text-xs text-base-content/40">Playbooks linkage automático por dispositivo y tipo de alerta</p>
        </div>
        <div className="flex gap-2">
          <select className="select select-xs select-bordered" value={filterKind} onChange={e => setFilterKind(e.target.value)}>
            <option value="">Todos los equipos</option>
            <option value="OLT">OLT</option>
            <option value="PON_PORT">PON</option>
            <option value="SPLITTER">Splitter</option>
            <option value="CTO">CTO</option>
            <option value="ONU">ONU</option>
          </select>
          <button className={`btn btn-xs btn-ghost ${loading ? 'loading' : ''}`} onClick={() => void fetchRunbooks()} disabled={loading}>↻</button>
        </div>
      </div>

      {error && <div className="alert alert-error py-2 text-xs">{error}</div>}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        {/* Runbook list */}
        <div className="space-y-1.5">
          <div className="text-[10px] font-medium uppercase tracking-wider text-base-content/30">Runbooks ({runbooks.length})</div>
          {runbooks.length === 0 && !loading && (
            <p className="text-xs text-base-content/30 py-4 text-center">Sin runbooks para este filtro</p>
          )}
          {runbooks.map(rb => (
            <button
              key={rb.id}
              onClick={() => { setSelectedId(rb.id); void recordUse(rb.id); }}
              className={`w-full text-left rounded-lg border p-2.5 transition-all ${selectedId === rb.id ? 'border-primary bg-primary/5' : 'border-base-200 hover:border-base-300'}`}
            >
              <div className="flex items-start justify-between gap-1">
                <span className="text-xs font-medium leading-tight">{rb.title}</span>
                {rb.useCount > 0 && (
                  <span className="badge badge-xs badge-ghost shrink-0">{rb.useCount}×</span>
                )}
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {rb.deviceKind && <span className="badge badge-xs badge-outline">{rb.deviceKind}</span>}
                {rb.severity && <span className={`badge badge-xs ${rb.severity === 'critical' ? 'badge-error' : 'badge-warning'}`}>{rb.severity}</span>}
                {rb.tags.slice(0, 2).map(t => (
                  <span key={t} className="badge badge-xs badge-ghost">{t}</span>
                ))}
              </div>
            </button>
          ))}

          {/* History */}
          {history.length > 0 && (
            <div className="mt-3">
              <div className="text-[10px] font-medium uppercase tracking-wider text-base-content/30 mb-1.5">Historia reciente</div>
              {history.map(h => (
                <div key={h.id} className="mb-2 rounded-lg border border-base-200 p-2">
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="badge badge-xs badge-outline">{h.deviceKind}</span>
                    <span className="font-mono text-[10px] text-base-content/40">{h.deviceId}</span>
                  </div>
                  <div className="truncate text-[10px] font-medium text-base-content/70">{h.summary}</div>
                  {h.rootCause && (
                    <div className="mt-1 text-[9px] text-base-content/40">
                      <span className="text-error">RC: </span>{h.rootCause.slice(0, 80)}…
                    </div>
                  )}
                  {h.fix && (
                    <div className="mt-0.5 text-[9px] text-success">
                      Fix: {h.fix.slice(0, 80)}…
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Runbook detail */}
        <div className="lg:col-span-2">
          {selected ? (
            <div className="rounded-xl border border-base-200 bg-base-100 p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h4 className="text-sm font-bold">{selected.title}</h4>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {selected.deviceKind && <span className="badge badge-sm badge-outline">{selected.deviceKind}</span>}
                    {selected.deviceId && <span className="badge badge-sm badge-ghost">{selected.deviceId}</span>}
                    {selected.alertKind && <span className="badge badge-sm badge-ghost">{selected.alertKind}</span>}
                    {selected.severity && <span className={`badge badge-sm ${selected.severity === 'critical' ? 'badge-error' : 'badge-warning'}`}>{selected.severity}</span>}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="font-mono text-lg font-black text-primary">{selected.useCount}</div>
                  <div className="text-[9px] text-base-content/40">veces usado</div>
                  {selected.lastUsedAt && (
                    <div className="text-[9px] text-base-content/30">
                      Último: {new Date(selected.lastUsedAt).toLocaleDateString('es-ES')}
                    </div>
                  )}
                </div>
              </div>

              <div className="divider my-1" />

              {/* Content — rendered as steps */}
              <div className="space-y-2">
                {selected.content.split(/\n+/).filter(s => s.trim()).map((step, i) => {
                  const trimmed = step.trim();
                  const isHeader = trimmed.startsWith('#') || trimmed.startsWith('**') || /^\d+[\.\)]\s/.test(trimmed);
                  const isCode = trimmed.startsWith('```') || trimmed.startsWith('$') || trimmed.startsWith('>');
                  return (
                    <div key={i} className={`
                      ${isHeader ? 'text-sm font-semibold text-base-content/80 mt-2' : ''}
                      ${isCode ? 'rounded bg-base-200 px-3 py-2 font-mono text-xs text-base-content/70' : 'text-xs text-base-content/60'}
                    `}>
                      {trimmed}
                    </div>
                  );
                })}
              </div>

              {selected.tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {selected.tags.map(t => (
                    <span key={t} className="badge badge-sm badge-ghost">{t}</span>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-base-200 py-12 text-center">
              <span className="text-2xl">📖</span>
              <p className="text-sm text-base-content/50">Seleccioná un runbook</p>
              <p className="text-xs text-base-content/30">o filtrá por equipo/tipo de alerta</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
