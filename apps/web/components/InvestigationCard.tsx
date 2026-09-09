'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth/client';
import { hasPermission } from '@/lib/auth/permissions';
import type {
  HypothesisSupportLevel,
  InvestigationCheckKind,
  InvestigationEvidenceKind,
  InvestigationResult,
  InvestigationSufficiencyState,
} from '@ftth-copilot/shared';

// ── Snapshot-locked UI labels (Spanish) ──────────────────────────────────────

export const SUFFICIENCY_LABELS: Record<InvestigationSufficiencyState, string> = {
  sufficient: 'Suficiente',
  provisional: 'Provisional',
  insufficient: 'Insuficiente',
};

export const HYPOTHESIS_SUPPORT_LABELS: Record<HypothesisSupportLevel, string> = {
  supported: 'Respaldada',
  contradicted: 'Contradicha',
  mixed: 'Mixta',
  unverified: 'No verificada',
};

export const EVIDENCE_QUALITY_LABELS: Record<string, string> = {
  fresh: 'Vigente',
  stale: 'Vencida',
  insufficient: 'Insuficiente',
  unknown: 'Desconocida',
  error: 'Error',
};

export const CHECK_KIND_LABELS: Record<InvestigationCheckKind, string> = {
  observe_only: 'Observación directa',
  topology_lookup: 'Consulta de topología',
  recent_events: 'Eventos recientes',
  metric_history: 'Historial de métricas',
};

export const EVIDENCE_KIND_LABELS: Record<InvestigationEvidenceKind, string> = {
  metric: 'Métrica',
  event: 'Evento',
  topology: 'Topología',
  incident_history: 'Historial de incidentes',
  feedback: 'Feedback técnico',
};

const READ_ONLY_CHECK_KINDS: ReadonlySet<string> = new Set<InvestigationCheckKind>([
  'observe_only',
  'topology_lookup',
  'recent_events',
  'metric_history',
]);

// ── Formatters and assertions ────────────────────────────────────────────────

export function formatSufficiency(state: InvestigationSufficiencyState): string {
  return SUFFICIENCY_LABELS[state] ?? state;
}

export function formatHypothesisSupport(supportLevel: HypothesisSupportLevel): string {
  return HYPOTHESIS_SUPPORT_LABELS[supportLevel] ?? supportLevel;
}

export function formatEvidenceQuality(quality: string): string {
  return EVIDENCE_QUALITY_LABELS[quality] ?? quality;
}

export function formatCheckKind(kind: InvestigationCheckKind): string {
  return CHECK_KIND_LABELS[kind] ?? kind;
}

export function assertReadOnlyCheckKind(kind: InvestigationCheckKind): boolean {
  if (!READ_ONLY_CHECK_KINDS.has(kind)) {
    throw new Error(`Only read-only check kinds allowed: received ${kind}`);
  }
  return true;
}

export function buildRefreshInvestigationPayload(): { refresh: boolean } {
  return { refresh: true };
}

// ── Styling badge helpers ────────────────────────────────────────────────────

export function getSufficiencyBadgeClass(sufficiency: InvestigationSufficiencyState): string {
  switch (sufficiency) {
    case 'sufficient':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
    case 'provisional':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
    case 'insufficient':
      return 'border-rose-500/30 bg-rose-500/10 text-rose-300';
    default:
      return 'border-neutral-500/30 bg-neutral-500/10 text-neutral-300';
  }
}

export function getHypothesisSupportBadgeClass(supportLevel: HypothesisSupportLevel): string {
  switch (supportLevel) {
    case 'supported':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
    case 'contradicted':
      return 'border-rose-500/30 bg-rose-500/10 text-rose-300';
    case 'mixed':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
    case 'unverified':
      return 'border-neutral-500/30 bg-neutral-500/10 text-neutral-400';
    default:
      return 'border-neutral-500/30 bg-neutral-500/10 text-neutral-300';
  }
}

export function getEvidenceQualityBadgeClass(quality: string): string {
  switch (quality) {
    case 'fresh':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
    case 'stale':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
    case 'insufficient':
    case 'error':
      return 'border-rose-500/30 bg-rose-500/10 text-rose-300';
    case 'unknown':
    default:
      return 'border-neutral-500/30 bg-neutral-500/10 text-neutral-400';
  }
}

// ── Types ────────────────────────────────────────────────────────────────────

type FeedbackLabel = 'confirmed' | 'incorrect' | 'insufficient_data';

interface FeedbackRow {
  feedbackId: string;
  runId: string;
  versionId: string;
  label: string;
  observations: string | null;
  realCause: string | null;
  resolutionEvidence: string | null;
  authorUserId: string;
  submittedAt: string;
}

interface InvestigationVersionResponse {
  versionId: string;
  versionIndex: number;
  rulesetVersion: string;
  modelVersion: string;
  snapshotAt: string;
  snapshot: InvestigationResult;
}

interface InvestigationApiResponse {
  runId: string | null;
  versionId?: string | null;
  versionIndex?: number;
  status: 'pending' | 'ready' | 'failed' | 'expired';
  retryAfterMs?: number;
  message?: string;
  version?: InvestigationVersionResponse | null;
  result?: InvestigationResult | null;
  idempotent?: boolean;
}

export interface InvestigationCardProps {
  incidentId: string;
}

const FEEDBACK_BUTTONS: { label: FeedbackLabel; title: string }[] = [
  { label: 'confirmed', title: 'Confirmar diagnóstico' },
  { label: 'incorrect', title: 'Incorrecto' },
  { label: 'insufficient_data', title: 'Faltan datos' },
];

export function InvestigationCard({ incidentId }: InvestigationCardProps) {
  const auth = useAuth();
  const [data, setData] = useState<InvestigationApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [polling, setPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedbacks, setFeedbacks] = useState<FeedbackRow[]>([]);
  const [submittingFeedback, setSubmittingFeedback] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);

  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);
  const fetchInvestigationRef = useRef<(() => Promise<void>) | null>(null);
  const canView = auth.user ? hasPermission(auth.user.role, 'view_network') : false;

  const loadFeedbacks = useCallback(async (runId: string) => {
    try {
      const response = await fetch(
        `/api/investigations/${encodeURIComponent(runId)}/feedbacks`,
        { credentials: 'include' },
      );
      if (response.ok) {
        const body = (await response.json().catch(() => ({}))) as { feedbacks?: FeedbackRow[] };
        setFeedbacks(body.feedbacks ?? []);
      }
    } catch {
      // Keep existing list on network error
    }
  }, []);

  const fetchInvestigation = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/incidents/${encodeURIComponent(incidentId)}/investigate`,
        { credentials: 'include' },
      );

      if (res.status === 404) {
        setData(null);
        return;
      }

      if (res.status === 429) {
        setError('Cuota de investigación alcanzada. Intentá nuevamente en unos minutos.');
        return;
      }

      if (!res.ok) {
        setError('No se pudo cargar la investigación.');
        return;
      }

      const body = (await res.json().catch(() => null)) as InvestigationApiResponse | null;
      if (!body) {
        setError('Respuesta inválida del servidor.');
        return;
      }

      setData(body);

      if (body.runId) {
        void loadFeedbacks(body.runId);
      }

      if (body.status === 'pending') {
        setPolling(true);
        const retryDelay = body.retryAfterMs ?? 3000;
        if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
        pollTimerRef.current = setTimeout(() => {
          void fetchInvestigationRef.current?.();
        }, retryDelay);
      } else {
        setPolling(false);
      }
    } catch {
      setError('Error de conexión al cargar la investigación.');
    } finally {
      setLoading(false);
    }
  }, [canView, incidentId, loadFeedbacks]);

  useEffect(() => {
    fetchInvestigationRef.current = fetchInvestigation;
  });

  useEffect(() => {
    queueMicrotask(() => {
      void fetchInvestigation();
    });
    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, [fetchInvestigation]);

  const triggerInvestigation = useCallback(
    async (refresh = false) => {
      if (!canView) return;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/incidents/${encodeURIComponent(incidentId)}/investigate`,
          {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(refresh ? buildRefreshInvestigationPayload() : {}),
          },
        );

        if (res.status === 429) {
          setError('Cuota de investigación alcanzada. Intentá nuevamente en unos minutos.');
          return;
        }

        if (res.status === 202) {
          const body = (await res.json().catch(() => ({}))) as InvestigationApiResponse;
          setData({
            runId: body.runId ?? null,
            status: 'pending',
            retryAfterMs: body.retryAfterMs ?? 3000,
          });
          setPolling(true);
          const delay = body.retryAfterMs ?? 3000;
          if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
          pollTimerRef.current = setTimeout(() => {
            void fetchInvestigationRef.current?.();
          }, delay);
          return;
        }

        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          setError(body.error ?? 'No se pudo iniciar la investigación.');
          return;
        }

        const body = (await res.json().catch(() => null)) as InvestigationApiResponse | null;
        if (body) {
          setData(body);
          if (body.runId) {
            void loadFeedbacks(body.runId);
          }
        }
      } catch {
        setError('Error de conexión al iniciar la investigación.');
      } finally {
        setLoading(false);
      }
    },
    [canView, incidentId, loadFeedbacks],
  );

  const submitFeedback = useCallback(
    async (label: FeedbackLabel) => {
      const runId = data?.runId;
      const versionId = data?.version?.versionId ?? data?.versionId;
      if (!runId || !versionId) return;

      setSubmittingFeedback(true);
      setFeedbackError(null);
      try {
        const response = await fetch(
          `/api/investigations/${encodeURIComponent(runId)}/versions/${encodeURIComponent(
            versionId,
          )}/feedback`,
          {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ label }),
          },
        );

        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { error?: string };
          setFeedbackError(body.error ?? 'No se pudo registrar la validación.');
          return;
        }

        await loadFeedbacks(runId);
      } catch {
        setFeedbackError('Error de red al registrar la validación.');
      } finally {
        setSubmittingFeedback(false);
      }
    },
    [data, loadFeedbacks],
  );

  if (!canView) return null;

  const result: InvestigationResult | null = data?.version?.snapshot ?? data?.result ?? null;
  const versionIndex = data?.version?.versionIndex ?? data?.versionIndex ?? 0;
  const versionId = data?.version?.versionId ?? data?.versionId ?? null;

  return (
    <div
      className="mt-3 rounded-xl border border-white/[0.08] bg-neutral-950/60 p-4 sm:p-5 text-neutral-200"
      data-testid={`investigation-card-${incidentId}`}
    >
      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] pb-3.5">
        <div className="flex items-center gap-2.5">
          <span className="flex h-2.5 w-2.5 rounded-full bg-indigo-400 ring-4 ring-indigo-400/20" />
          <h3 className="text-sm font-semibold tracking-tight text-white">
            Investigación Cognitiva
          </h3>
          {result ? (
            <span className="rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 text-[11px] font-mono text-neutral-400">
              v{versionIndex}
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          {result ? (
            <button
              type="button"
              disabled={loading || polling}
              onClick={() => void triggerInvestigation(true)}
              data-testid={`investigation-refresh-button-${incidentId}`}
              className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-xs font-medium text-neutral-300 hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading || polling ? 'Reinvestigando…' : 'Reinvestigar'}
            </button>
          ) : null}
        </div>
      </div>

      {/* ── Error Banner ── */}
      {error ? (
        <div
          className="mt-3 rounded-lg border border-rose-500/20 bg-rose-500/10 p-3 text-xs text-rose-300"
          data-testid={`investigation-error-${incidentId}`}
        >
          {error}
        </div>
      ) : null}

      {/* ── In-Flight / Polling State ── */}
      {polling || (data?.status === 'pending' && !result) ? (
        <div
          className="mt-4 flex items-center gap-3 rounded-lg border border-indigo-500/20 bg-indigo-500/10 p-3 text-xs text-indigo-200"
          data-testid={`investigation-pending-${incidentId}`}
        >
          <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-indigo-300 border-t-transparent" />
          <span>Analizando telemetría, eventos y topología en curso…</span>
        </div>
      ) : null}

      {/* ── Empty State / Initial Trigger ── */}
      {!result && !polling && !loading && !error ? (
        <div className="mt-4 text-center py-6">
          <p className="text-xs text-neutral-400 mb-3">
            Aún no se ha realizado una investigación cognitiva para este incidente.
          </p>
          <button
            type="button"
            onClick={() => void triggerInvestigation(false)}
            data-testid={`investigation-start-button-${incidentId}`}
            className="rounded-lg border border-indigo-500/30 bg-indigo-500/15 px-3.5 py-1.5 text-xs font-medium text-indigo-200 hover:bg-indigo-500/25"
          >
            Iniciar investigación cognitiva
          </button>
        </div>
      ) : null}

      {/* ── Full Diagnostic Snapshot ── */}
      {result ? (
        <div className="mt-4 space-y-5">
          {/* 1. Sufficiency & Summary */}
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3.5">
            <div className="flex flex-wrap items-center gap-2 mb-1.5">
              <span className="text-xs font-semibold text-neutral-300">Estado de Suficiencia:</span>
              <span
                className={`rounded-md border px-2 py-0.5 text-xs font-medium ${getSufficiencyBadgeClass(
                  result.sufficiency,
                )}`}
                data-testid={`investigation-sufficiency-badge-${incidentId}`}
              >
                {formatSufficiency(result.sufficiency)}
              </span>
            </div>
            <p
              className="text-xs text-neutral-300 leading-relaxed"
              data-testid={`investigation-sufficiency-reason-${incidentId}`}
            >
              {result.sufficiencyReason}
            </p>
            <div className="mt-2 text-[11px] text-neutral-500 flex flex-wrap gap-x-3 gap-y-1">
              <span>Corte: {new Date(result.cutoffAt).toLocaleString()}</span>
              <span>Reglas: {result.rulesetVersion}</span>
              <span>Modelo: {result.modelVersion}</span>
            </div>
          </div>

          {/* 2. Competing Hypotheses */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-2.5">
              Hipótesis Diagnosticadas
            </h4>
            <div className="space-y-2.5" data-testid={`investigation-hypotheses-${incidentId}`}>
              {result.hypotheses.map((hyp) => (
                <div
                  key={hyp.hypothesisId}
                  className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3"
                  data-testid={`investigation-hypothesis-${hyp.hypothesisId}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                    <span className="text-xs font-medium text-white">{hyp.summary}</span>
                    <span
                      className={`rounded-md border px-2 py-0.5 text-[11px] font-medium ${getHypothesisSupportBadgeClass(
                        hyp.supportLevel,
                      )}`}
                    >
                      {formatHypothesisSupport(hyp.supportLevel)}
                    </span>
                  </div>

                  {/* Evidencia a favor */}
                  {hyp.forRefIds.length > 0 ? (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                      <span className="text-emerald-400 font-medium">A favor:</span>
                      {hyp.forRefIds.map((refId) => (
                        <span
                          key={refId}
                          className="rounded bg-emerald-500/10 px-1.5 py-0.5 font-mono text-emerald-300 border border-emerald-500/20"
                        >
                          {refId}
                        </span>
                      ))}
                    </div>
                  ) : null}

                  {/* Contraevidencia */}
                  {hyp.againstRefIds.length > 0 ? (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                      <span className="text-rose-400 font-medium">En contra:</span>
                      {hyp.againstRefIds.map((refId) => (
                        <span
                          key={refId}
                          className="rounded bg-rose-500/10 px-1.5 py-0.5 font-mono text-rose-300 border border-rose-500/20"
                        >
                          {refId}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>

          {/* 3. Evidence References */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-2.5">
              Evidencias Recolectadas ({result.evidenceRefs.length})
            </h4>
            <div
              className="max-h-56 overflow-y-auto rounded-lg border border-white/[0.06] divide-y divide-white/[0.04]"
              data-testid={`investigation-evidence-list-${incidentId}`}
            >
              {result.evidenceRefs.map((ev) => (
                <div key={ev.evidenceRefId} className="p-2.5 text-xs bg-white/[0.01]">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[11px] text-neutral-400">
                        {ev.evidenceRefId}
                      </span>
                      <span className="rounded bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-neutral-300">
                        {EVIDENCE_KIND_LABELS[ev.kind] ?? ev.kind}
                      </span>
                      <span className="text-[11px] text-neutral-500">{ev.source}</span>
                    </div>
                    <span
                      className={`rounded border px-1.5 py-0.5 text-[10px] ${getEvidenceQualityBadgeClass(
                        ev.quality,
                      )}`}
                    >
                      {formatEvidenceQuality(ev.quality)}
                    </span>
                  </div>
                  <p className="text-neutral-300 text-[11px] leading-relaxed">{ev.summary}</p>
                </div>
              ))}
            </div>
          </div>

          {/* 4. Contradictions & Missing Data */}
          {(result.contradictions.length > 0 || result.missing.length > 0) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* Contradicciones */}
              {result.contradictions.length > 0 ? (
                <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                  <h5 className="text-xs font-semibold text-amber-300 mb-2">
                    Contradicciones ({result.contradictions.length})
                  </h5>
                  <ul className="space-y-1.5 text-xs text-neutral-300">
                    {result.contradictions.map((c, i) => (
                      <li key={i} className="flex flex-col gap-0.5">
                        <span className="font-mono text-[11px] text-amber-400">
                          Ref: {c.evidenceRefId}
                        </span>
                        <span className="text-[11px] text-neutral-400">{c.note}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {/* Faltantes */}
              {result.missing.length > 0 ? (
                <div className="rounded-lg border border-neutral-700/50 bg-neutral-900/40 p-3">
                  <h5 className="text-xs font-semibold text-neutral-300 mb-2">
                    Observaciones Faltantes ({result.missing.length})
                  </h5>
                  <ul className="space-y-2 text-xs text-neutral-300">
                    {result.missing.map((m, i) => (
                      <li key={i} className="flex flex-col gap-0.5">
                        <span className="font-medium text-neutral-200">{m.what}</span>
                        {m.whyItMatters ? (
                          <span className="text-[11px] text-neutral-400">{m.whyItMatters}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          )}

          {/* 5. Suggested Read-Only Checks */}
          {result.suggestedChecks.length > 0 ? (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-2.5">
                Comprobaciones Sugeridas (Solo Lectura)
              </h4>
              <div
                className="space-y-2"
                data-testid={`investigation-checks-${incidentId}`}
              >
                {result.suggestedChecks.map((chk) => {
                  assertReadOnlyCheckKind(chk.kind);
                  return (
                    <div
                      key={chk.checkId}
                      className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5 text-xs"
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="rounded bg-sky-500/10 text-sky-300 border border-sky-500/20 px-1.5 py-0.5 text-[10px] font-medium">
                          {formatCheckKind(chk.kind)}
                        </span>
                        <span className="text-white font-medium">{chk.description}</span>
                      </div>
                      {chk.expectedToResolve ? (
                        <p className="text-[11px] text-neutral-400">
                          Resuelve: {chk.expectedToResolve}
                        </p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {/* 6. Human Validation (Feedback) */}
          <div
            className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3.5"
            data-testid={`investigation-feedback-section-${incidentId}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <h4 className="text-xs font-semibold text-white">Validación de Diagnóstico (NOC)</h4>
              {versionId ? (
                <span className="text-[10px] font-mono text-neutral-500">
                  Version: {versionId}
                </span>
              ) : null}
            </div>
            <p className="text-xs text-neutral-400 mb-3">
              Confirmá o refutá las hipótesis para enriquecer el contexto histórico de incidentes similares.
            </p>

            <div className="flex flex-wrap items-center gap-2">
              {FEEDBACK_BUTTONS.map((btn) => (
                <button
                  key={btn.label}
                  type="button"
                  disabled={submittingFeedback || !versionId}
                  onClick={() => void submitFeedback(btn.label)}
                  data-testid={`investigation-feedback-btn-${btn.label}-${incidentId}`}
                  className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-neutral-100 hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {btn.title}
                </button>
              ))}
            </div>

            {feedbackError ? (
              <p
                className="mt-2 text-xs text-rose-300"
                data-testid={`investigation-feedback-error-${incidentId}`}
              >
                {feedbackError}
              </p>
            ) : null}

            {feedbacks.length > 0 ? (
              <div className="mt-3 border-t border-white/[0.06] pt-2.5">
                <h5 className="text-[11px] font-semibold text-neutral-400 mb-1.5">
                  Validaciones registradas:
                </h5>
                <ul className="space-y-1 text-[11px] text-neutral-400">
                  {feedbacks.map((f) => (
                    <li
                      key={f.feedbackId}
                      className="flex flex-wrap items-center gap-x-2 font-mono"
                    >
                      <span className="text-neutral-200">{f.label}</span>
                      <span>·</span>
                      <span>{new Date(f.submittedAt).toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
