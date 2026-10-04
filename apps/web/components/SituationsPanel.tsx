'use client';

import { useCallback, useEffect, useState } from 'react';

interface CorrelationGroup {
  schema: string; groupId: string; tenantId: string;
  ancestorKind: string; ancestorId: string;
  windowStart: string; windowEnd: string;
  affectedCount: number; totalPopulation: number; affectedRatio: number;
  affectedDeviceIds: string[]; healthyDeviceIds: string[];
  evidenceEventIds: string[]; ruleMatched: string; hypothesisSupport: string;
}

interface SituationSummary { totalSituations: number; criticalSituations: number; totalEvents: number; windowHours: number }

interface SituationsResponse { situations: CorrelationGroup[]; summary: SituationSummary }

const KIND_ICON: Record<string, string> = { OLT: '🔵', PON_PORT: '⚪', SPLITTER: '◐', CTO: '🔶', ONU: '🔴' };
const KIND_COLOR: Record<string, string> = { OLT: '#3b82f6', PON_PORT: '#6b7280', SPLITTER: '#f59e0b', CTO: '#8b5cf6' };

export function SituationsPanel() {
  const [situations, setSituations] = useState<CorrelationGroup[]>([]);
  const [summary, setSummary] = useState<SituationSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hours, setHours] = useState(6);

  const fetchSituations = useCallback(async () => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true); setError(null);
    try {
      const r = await fetch(`/api/ops/situations?hours=${hours}`, { credentials: 'include' });
      if (!r.ok) throw new Error(await r.text());
      const data: SituationsResponse = await r.json();
      setSituations(data.situations ?? []);
      setSummary(data.summary ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error fetching situations');
    } finally {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(false);
    }
  }, [hours]);

  useEffect(() => {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void fetchSituations(); }, [fetchSituations]);

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold">Situaciones correlacionadas</h3>
          <p className="text-xs text-base-content/40">
            Alert storms agrupadas por ancestro compartido · ventana {hours}h
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select className="select select-xs select-bordered" value={hours} onChange={e => setHours(Number(e.target.value))}>
            <option value={1}>1h</option><option value={3}>3h</option>
            <option value={6}>6h</option><option value={12}>12h</option><option value={24}>24h</option>
          </select>
          <button className={`btn btn-xs btn-ghost ${loading ? 'loading' : ''}`} onClick={() => void fetchSituations()} disabled={loading}>
            ↻
          </button>
        </div>
      </div>

      {/* Summary badges */}
      {summary && (
        <div className="flex flex-wrap gap-2">
          <span className="badge badge-lg badge-outline">{summary.totalSituations} situaciones</span>
          <span className="badge badge-lg badge-error gap-1">{summary.criticalSituations} críticas</span>
          <span className="badge badge-lg badge-outline">{summary.totalEvents} eventos</span>
        </div>
      )}

      {error && <div className="alert alert-error py-2 text-xs">{error}</div>}

      {/* Situation cards */}
      {situations.length === 0 && !loading && (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-base-200 py-8 text-center">
          <span className="text-2xl">✅</span>
          <p className="text-sm font-medium text-success">Sin situaciones activas</p>
          <p className="text-xs text-base-content/40">No hay eventos correlacionados en la ventana actual</p>
        </div>
      )}

      <div className="space-y-2">
        {situations.map((s) => {
          const pct = Math.round(s.affectedRatio * 100);
          const col = pct >= 50 ? '#ef4444' : pct >= 20 ? '#f59e0b' : '#10b981';
          const icon = KIND_ICON[s.ancestorKind] ?? '◽';
          const kindCol = KIND_COLOR[s.ancestorKind] ?? '#6b7280';

          return (
            <details key={s.groupId} className="rounded-xl border bg-base-100 group">
              <summary className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-base-200/30">
                <span className="text-lg">{icon}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold uppercase" style={{ color: kindCol }}>{s.ancestorKind}</span>
                    <span className="font-mono text-xs font-semibold">{s.ancestorId}</span>
                    <span className="badge badge-xs" style={{ backgroundColor: col + '20', color: col }}>
                      {s.affectedCount}/{s.totalPopulation} ({pct}%)
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-base-content/50">{s.hypothesisSupport}</p>
                </div>
                <div className="shrink-0 text-right">
                  <div className="font-mono text-xs font-bold" style={{ color: col }}>
                    {pct >= 50 ? 'CRÍTICA' : pct >= 20 ? 'WARNING' : 'LOW'}
                  </div>
                  <div className="text-[9px] text-base-content/40">
                    {new Date(s.windowStart).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              </summary>

              <div className="border-t border-base-200 px-4 py-3 space-y-2">
                {/* Impact bar */}
                <div className="space-y-1">
                  <div className="flex justify-between text-[10px] text-base-content/50">
                    <span>Afectados</span>
                    <span className="font-mono">{s.affectedCount} de {s.totalPopulation}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-base-200">
                    <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: col }} />
                  </div>
                </div>

                {/* Affected devices */}
                <div>
                  <div className="mb-1 text-[10px] text-base-content/40">Dispositivos afectados ({s.affectedDeviceIds.length})</div>
                  <div className="flex flex-wrap gap-1">
                    {s.affectedDeviceIds.slice(0, 20).map(id => (
                      <span key={id} className="rounded bg-error/10 px-1.5 py-0.5 font-mono text-[9px] text-error">{id}</span>
                    ))}
                    {s.affectedDeviceIds.length > 20 && (
                      <span className="rounded bg-base-200 px-1.5 py-0.5 text-[9px]">+{s.affectedDeviceIds.length - 20} más</span>
                    )}
                  </div>
                </div>

                {/* Healthy devices */}
                {s.healthyDeviceIds.length > 0 && (
                  <div>
                    <div className="mb-1 text-[10px] text-base-content/40">Dispositivos OK ({s.healthyDeviceIds.length})</div>
                    <div className="flex flex-wrap gap-1">
                      {s.healthyDeviceIds.slice(0, 10).map(id => (
                        <span key={id} className="rounded bg-success/10 px-1.5 py-0.5 font-mono text-[9px] text-success">{id}</span>
                      ))}
                      {s.healthyDeviceIds.length > 10 && (
                        <span className="rounded bg-base-200 px-1.5 py-0.5 text-[9px]">+{s.healthyDeviceIds.length - 10} más</span>
                      )}
                    </div>
                  </div>
                )}

                {/* Evidence */}
                <div className="rounded bg-base-200/40 p-2">
                  <div className="text-[9px] text-base-content/40 mb-1">Evidencia ({s.evidenceEventIds.length} eventos)</div>
                  <div className="space-y-0.5">
                    {s.evidenceEventIds.slice(0, 5).map(evId => (
                      <div key={evId} className="font-mono text-[9px] text-base-content/40">{evId}</div>
                    ))}
                  </div>
                </div>

                {/* Rule matched */}
                <div className="text-[9px] text-base-content/30">
                  Regla: <code className="font-mono">{s.ruleMatched}</code>
                </div>
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}
