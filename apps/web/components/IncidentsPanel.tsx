'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth/client';
import { hasPermission } from '@/lib/auth/permissions';
import { ServerStackIcon } from './icons';
import { FeedbackControls } from './FeedbackControls';
import { InvestigationCard } from './InvestigationCard';
import { csrfFetch } from '@/lib/auth/csrf-client';

// ── Fase E — temporal topology impact (Fase E-7.1) ───────────────────────────
//
// Both roles fetch the same JSON body (`/api/topology/downstream`) and only
// differ in rendering: OWNER/ADMIN see an expandable accordion with the full
// ONU list + per-ONU status; OPERATOR/MEMBER see a compact summary line.
// Snapshot-locked Spanish strings — the snapshot test in
// `apps/web/tests/components/topology-impact.test.tsx` asserts byte equality.
export const TOPOLOGY_HEADING_OWNER_ADMIN = 'Análisis de impacto';
export const TOPOLOGY_HEADING_OPERATOR_MEMBER = 'Resumen';
export const TOPOLOGY_EMPTY_MESSAGE = 'No hay datos de topología para este dispositivo.';

type TopologyNodeKind = 'OLT' | 'PON_PORT' | 'SPLITTER' | 'CTO' | 'ONU';

interface TopologyImpactProps {
  deviceKind: TopologyNodeKind | string;
  deviceId: string;
  /** When true, renders the expandable accordion (OWNER/ADMIN). */
  expandable: boolean;
}

interface Incident {
  id: string;
  deviceKind: string;
  deviceId: string;
  title: string;
  description: string;
  severity: 'warning' | 'critical';
  status: 'open' | 'acknowledged' | 'resolved';
  firstSeenAt: string;
  lastSeenAt: string;
  alertCount: number;
}

interface ConfirmState {
  incident: Incident;
  rootCause: string;
  fix: string;
  summary: string;
  submitting: boolean;
  error?: string;
  success?: boolean;
}

export function IncidentsPanel() {
  const auth = useAuth();
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [openInvestigations, setOpenInvestigations] = useState<Record<string, boolean>>({});

  const canConfirm = auth.user ? hasPermission(auth.user.role, 'view_network') : false;

  const toggleInvestigation = useCallback((incidentId: string) => {
    setOpenInvestigations((prev) => ({
      ...prev,
      [incidentId]: !prev[incidentId],
    }));
  }, []);

  const load = useCallback(async () => {
    if (!auth.user) return;
    try {
      const response = await fetch('/api/incidents', { credentials: 'include' });
      const body = await response.json().catch(() => ({}));
      setIncidents(body.incidents ?? []);
    } catch {
      // noop — a failed incidents read should never block the dashboard
    } finally {
      setLoading(false);
    }
  }, [auth.user]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  const openConfirm = useCallback(
    (incident: Incident) => {
      if (!canConfirm) return;
      setConfirm({
        incident,
        rootCause: '',
        fix: '',
        summary: incident.title,
        submitting: false,
      });
    },
    [canConfirm],
  );

  const closeConfirm = useCallback(() => setConfirm(null), []);

  const submitConfirm = useCallback(async () => {
    if (!confirm) return;
    setConfirm({ ...confirm, submitting: true, error: undefined });
    try {
      const response = await csrfFetch(
        `/api/incidents/${confirm.incident.id}/confirm`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            rootCause: confirm.rootCause,
            fix: confirm.fix,
            summary: confirm.summary,
          }),
        },
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        const message =
          response.status === 409
            ? 'Este incidente ya no está resuelto.'
            : response.status === 403
              ? 'No tenés permisos para confirmar incidentes.'
              : response.status === 404
                ? 'Incidente no encontrado.'
                : body.error ?? 'No se pudo confirmar el incidente.';
        setConfirm({ ...confirm, submitting: false, error: message });
        return;
      }
      setConfirm({ ...confirm, submitting: false, success: true });
      await load();
      // Auto-dismiss after a short pause so the operator sees the success state.
      setTimeout(() => setConfirm(null), 1200);
    } catch {
      setConfirm({
        ...confirm,
        submitting: false,
        error: 'Error de red al confirmar el incidente.',
      });
    }
  }, [confirm, load]);

  if (!auth.user) return null;
  if (!loading && incidents.length === 0) return null;

  return (
    <section className="card overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-5 py-4 sm:px-6">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-400/10 text-rose-300 ring-1 ring-inset ring-rose-300/15">
            <ServerStackIcon className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-white">Incidentes correlacionados</h2>
            <p className="mt-0.5 text-xs text-neutral-500">Alertas agrupadas por equipo</p>
          </div>
        </div>
        <span className="badge border border-white/[0.08] bg-white/[0.035] text-neutral-400">
          {incidents.length} incidente{incidents.length === 1 ? '' : 's'}
        </span>
      </div>

      {loading ? (
        <p className="px-6 py-4 text-xs text-neutral-500">Cargando incidentes…</p>
      ) : (
        <ul className="divide-y divide-white/[0.05]">
          {incidents.map((incident) => {
            const critical = incident.severity === 'critical';
            const resolved = incident.status === 'resolved';
            return (
              <li
                key={incident.id}
                data-testid={`incident-row-${incident.id}`}
                className="flex items-start gap-3 px-5 py-3.5 sm:px-6"
              >
                <span
                  className={`mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ring-1 ring-inset ${
                    critical
                      ? 'bg-rose-400/10 text-rose-300 ring-rose-300/20'
                      : 'bg-amber-400/10 text-amber-300 ring-amber-300/20'
                  }`}
                >
                  <ServerStackIcon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="text-sm font-medium text-white">{incident.title}</span>
                    <span className="badge border border-white/[0.08] bg-white/[0.035] text-neutral-400">
                      {incident.alertCount} alerta{incident.alertCount === 1 ? '' : 's'}
                    </span>
                    {resolved ? (
                      <span className="badge border border-emerald-300/20 bg-emerald-400/10 text-emerald-200">
                        Resuelto
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-xs leading-relaxed text-neutral-400">{incident.description}</p>
                  <div className="mt-1 text-[11px] text-neutral-500">
                    <span className="font-mono">{incident.deviceKind} · {incident.deviceId}</span>
                  </div>
                  {auth.user ? (
                    <TopologyImpact
                      deviceKind={incident.deviceKind}
                      deviceId={incident.deviceId}
                      expandable={
                        auth.user.role === 'OWNER' || auth.user.role === 'ADMIN'
                      }
                    />
                  ) : null}
                  {canConfirm ? (
                    <div className="mt-2">
                      <button
                        type="button"
                        onClick={() => toggleInvestigation(incident.id)}
                        className="rounded-md border border-indigo-500/30 bg-indigo-500/10 px-2.5 py-1 text-xs font-medium text-indigo-300 hover:bg-indigo-500/20"
                        data-testid={`toggle-investigation-${incident.id}`}
                      >
                        {openInvestigations[incident.id]
                          ? '▾ Ocultar investigación'
                          : '▸ Investigar incidente'}
                      </button>
                      {openInvestigations[incident.id] ? (
                        <InvestigationCard incidentId={incident.id} />
                      ) : null}
                    </div>
                  ) : null}
                  {canConfirm ? (
                    <FeedbackControls incidentId={incident.id} />
                  ) : null}
                  {canConfirm ? (
                    <PlanContextButton deviceKind={incident.deviceKind} deviceId={incident.deviceId} />
                  ) : null}
                </div>
                {resolved && canConfirm ? (
                  <button
                    type="button"
                    onClick={() => openConfirm(incident)}
                    className="rounded-lg border border-white/[0.08] bg-white/[0.035] px-3 py-1.5 text-xs font-medium text-neutral-100 hover:bg-white/[0.06]"
                  >
                    Marcar como confirmado
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {confirm ? (
        <ConfirmModal state={confirm} onClose={closeConfirm} onSubmit={submitConfirm} onChange={setConfirm} />
      ) : null}
    </section>
  );
}

function ConfirmModal({
  state,
  onClose,
  onSubmit,
  onChange,
}: {
  state: ConfirmState;
  onClose: () => void;
  onSubmit: () => void;
  onChange: (next: ConfirmState) => void;
}) {
  const canSubmit =
    state.rootCause.trim().length > 0 &&
    state.fix.trim().length > 0 &&
    state.summary.trim().length > 0 &&
    !state.submitting;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Confirmar incidente"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      data-testid="confirm-modal"
    >
      <div className="w-full max-w-md rounded-xl bg-neutral-900 p-5 text-neutral-100 shadow-xl ring-1 ring-white/[0.08]">
        <h3 className="text-base font-semibold">Marcar como confirmado</h3>
        <p className="mt-1 text-xs text-neutral-400">
          {state.incident.title} · {state.incident.deviceKind}/{state.incident.deviceId}
        </p>

        {state.success ? (
          <p className="mt-4 rounded-lg border border-emerald-300/20 bg-emerald-400/10 p-3 text-sm text-emerald-200">
            Incidente confirmado y guardado en memoria de la IA.
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            <label className="block">
              <span className="text-xs font-medium text-neutral-300">Causa raíz</span>
              <textarea
                className="mt-1 w-full rounded-lg border border-white/[0.08] bg-neutral-950 p-2 text-sm"
                rows={2}
                value={state.rootCause}
                onChange={(e) => onChange({ ...state, rootCause: e.target.value })}
                data-testid="confirm-root-cause"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-neutral-300">Solución aplicada</span>
              <textarea
                className="mt-1 w-full rounded-lg border border-white/[0.08] bg-neutral-950 p-2 text-sm"
                rows={2}
                value={state.fix}
                onChange={(e) => onChange({ ...state, fix: e.target.value })}
                data-testid="confirm-fix"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-neutral-300">Resumen</span>
              <textarea
                className="mt-1 w-full rounded-lg border border-white/[0.08] bg-neutral-950 p-2 text-sm"
                rows={2}
                value={state.summary}
                onChange={(e) => onChange({ ...state, summary: e.target.value })}
                data-testid="confirm-summary"
              />
            </label>
            {state.error ? (
              <p className="rounded-lg border border-rose-300/20 bg-rose-400/10 p-2 text-xs text-rose-200">
                {state.error}
              </p>
            ) : null}
          </div>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/[0.08] bg-transparent px-3 py-1.5 text-xs font-medium text-neutral-300 hover:bg-white/[0.05]"
          >
            {state.success ? 'Cerrar' : 'Cancelar'}
          </button>
          {!state.success ? (
            <button
              type="button"
              onClick={onSubmit}
              disabled={!canSubmit}
              className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-neutral-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {state.submitting ? 'Confirmando…' : 'Confirmar'}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * Fase E — `<TopologyImpact>` subcomponent. Fetches the downstream ONU list
 * for the impacted device from `/api/topology/downstream` and renders it
 * differently per role. Both roles always get the same JSON body; the
 * divergence is purely presentational (per design decision #9 in
 * `openspec/changes/fase-e-tenant-topology/design.md`).
 */
export function TopologyImpact({ deviceKind, deviceId, expandable }: TopologyImpactProps) {
  const [onuIds, setOnuIds] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(
          `/api/topology/downstream?kind=${encodeURIComponent(deviceKind)}&id=${encodeURIComponent(deviceId)}`,
          { credentials: 'include' },
        );
        if (!response.ok) {
          if (!cancelled) {
            setOnuIds([]);
            setLoading(false);
          }
          return;
        }
        const body = (await response.json().catch(() => ({}))) as { onuIds?: string[] };
        if (!cancelled) {
          setOnuIds(Array.isArray(body.onuIds) ? body.onuIds : []);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setOnuIds([]);
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deviceKind, deviceId]);

  if (loading) {
    return (
      <p className="mt-2 text-xs text-neutral-500" data-testid="topology-impact-loading">
        …
      </p>
    );
  }

  const heading = expandable ? TOPOLOGY_HEADING_OWNER_ADMIN : TOPOLOGY_HEADING_OPERATOR_MEMBER;
  const ids = onuIds ?? [];

  // Compact summary for OPERATOR/MEMBER — single line, no expansion.
  if (!expandable) {
    return (
      <div className="mt-2 text-xs text-neutral-400" data-testid="topology-impact-compact">
        <span className="font-medium text-neutral-300">{heading}:</span>{' '}
        {ids.length === 0 ? (
          <span className="text-neutral-500">{TOPOLOGY_EMPTY_MESSAGE}</span>
        ) : (
          <span>
            {deviceKind} · {ids.length} ONU{ids.length === 1 ? '' : 's'} afectadas
          </span>
        )}
      </div>
    );
  }

  // Expandable accordion for OWNER/ADMIN — click to reveal the full list.
  return (
    <div className="mt-2" data-testid="topology-impact-accordion">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        data-testid="topology-impact-toggle"
        className="flex items-center gap-2 rounded-md border border-white/[0.08] bg-white/[0.035] px-2.5 py-1 text-xs font-medium text-neutral-200 hover:bg-white/[0.06]"
      >
        <span aria-hidden="true">{open ? '▾' : '▸'}</span>
        <span>
          {heading}
          {ids.length === 0 ? null : (
            <span className="ml-1.5 text-neutral-500">
              · {ids.length} ONU{ids.length === 1 ? '' : 's'}
            </span>
          )}
        </span>
      </button>
      {open ? (
        <div className="mt-1.5 rounded-md border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5 text-xs text-neutral-300">
          {ids.length === 0 ? (
            <p className="text-neutral-500" data-testid="topology-impact-empty">
              {TOPOLOGY_EMPTY_MESSAGE}
            </p>
          ) : (
            <ul className="space-y-0.5" data-testid="topology-impact-list">
              {ids.map((onuId) => (
                <li key={onuId} className="flex items-center justify-between gap-2">
                  <span className="font-mono text-neutral-200">{onuId}</span>
                  <span className="text-[10px] uppercase tracking-wide text-neutral-500">
                    afectado
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Fiber Plan context button — shown in IncidentsPanel.
 * When a device has a marker in the fiber plan system, this renders
 * a "Ver plano" button that opens the relevant plan at the marker position.
 * @see packages/alerts/src/plan-correlation.ts for the server-side lookup.
 */
function PlanContextButton({ deviceKind, deviceId }: { deviceKind: string; deviceId: string }) {
  const [planInfo, setPlanInfo] = useState<{ planId: string; planName: string; markerCount: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [panelOpen, setPanelOpen] = useState(false);

  // Lazy-load on first render (don't block the panel)
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/fiber-plans/correlate?deviceKind=${encodeURIComponent(deviceKind)}&deviceId=${encodeURIComponent(deviceId)}`,
          { credentials: 'include' },
        );
        if (cancelled || !res.ok) return;
        const body = (await res.json().catch(() => ({}))) as {
          plans?: Array<{ plan: { id: string; name: string }; markerCount: number }>;
        };
        if (cancelled || !body.plans?.length) return;
        setPlanInfo({
          planId: body.plans[0].plan.id,
          planName: body.plans[0].plan.name,
          markerCount: body.plans[0].markerCount,
        });
      } catch {
        // noop — silently fail
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [deviceKind, deviceId]);

  if (loading) return null;
  if (!planInfo) return null;

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setPanelOpen(true)}
        className="flex items-center gap-1.5 rounded-md border border-indigo-500/30 bg-indigo-500/10 px-2.5 py-1 text-xs font-medium text-indigo-300 hover:bg-indigo-500/20"
        title={`Ver en plano: ${planInfo.planName}`}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
          <line x1="8" y1="2" x2="8" y2="18" />
          <line x1="16" y1="6" x2="16" y2="22" />
        </svg>
        Ver en plano
      </button>
      {panelOpen && (
        <PlanModal
          planId={planInfo.planId}
          planName={planInfo.planName}
          deviceKind={deviceKind}
          deviceId={deviceId}
          onClose={() => setPanelOpen(false)}
        />
      )}
    </div>
  );
}

/**
 * Full-screen modal that embeds the FiberPlanViewer for the matched plan,
 * centred on the marker position of the incident device.
 */
function PlanModal({
  planId,
  planName,
  deviceKind,
  deviceId,
  onClose,
}: {
  planId: string;
  planName: string;
  deviceKind: string;
  deviceId: string;
  onClose: () => void;
}) {
  const [plan, setPlan] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/fiber-plans/${planId}`, { credentials: 'include' });
        const body = (await res.json().catch(() => ({}))) as { plan?: unknown; error?: string };
        if (!res.ok) { setError(body.error ?? 'Error'); return; }
        setPlan(body.plan);
      } catch {
        setError('Error de red');
      } finally {
        setLoading(false);
      }
    })();
  }, [planId]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Plano: ${planName}`}
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/80 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="flex w-full max-w-6xl flex-col rounded-2xl bg-neutral-900 shadow-xl ring-1 ring-white/[0.08]" style={{ maxHeight: '90vh' }}>
        <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-3">
          <div>
            <h3 className="text-sm font-semibold text-white">{planName}</h3>
            <p className="text-xs text-neutral-500">
              Dispositivo: <span className="font-mono">{deviceKind} · {deviceId}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-neutral-400 hover:bg-white/[0.06] hover:text-white"
          >
            ×
          </button>
        </div>
        <div className="flex-1 overflow-hidden" style={{ minHeight: 400 }}>
          {loading ? (
            <div className="flex h-full items-center justify-center text-neutral-500 text-sm">Cargando plano…</div>
          ) : error ? (
            <div className="flex h-full items-center justify-center text-rose-400 text-sm">{error}</div>
          ) : plan ? (
            // Dynamic import to avoid circular deps — FiberPlanViewer is a client component
            <DynamicFiberPlanViewer plan={plan} />
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Wrapper that dynamically imports FiberPlanViewer only on the client */
function DynamicFiberPlanViewer({ plan }: { plan: any }) {
  const [Viewer, setViewer] = useState<React.ComponentType<{ plan: any }> | null>(null);
  useEffect(() => {
    import('./FiberPlanViewer').then((mod) => setViewer(() => mod.default));
  }, []);
  if (!Viewer) return null;
  return <Viewer plan={plan} />;
}