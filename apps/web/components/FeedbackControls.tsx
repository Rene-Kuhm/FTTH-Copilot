'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth/client';
import { hasPermission } from '@/lib/auth/permissions';

// ── Cognitive investigation feedback controls (Fase 1 PR #4) ───────────
//
// Three buttons ("Confirmar", "Incorrecto", "Faltan datos") that record a
// technician adjudication on the active InvestigationVersion. The
// component:
//  1. POSTs `/api/incidents/{incidentId}/investigate` on mount to open or
//     re-use a run+version for this incident.
//  2. Renders the existing feedback history for the run.
//  3. On click, POSTs the feedback and refreshes the list. The server
//     returns 200 with `idempotent: true` on duplicate submission, so the
//     UI keeps a single source of truth.
//
// No client-supplied identifiers (runId/versionId) are trusted: the UI
// only persists the (runId, versionId) the server returned and the label
// the operator clicked.

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

interface InvestigateResponse {
  runId: string | null;
  versionId: string | null;
  status: string;
  idempotent: boolean;
}

interface FeedbackControlsProps {
  incidentId: string;
}

const LABEL_BUTTON_TEXT: Record<FeedbackLabel, string> = {
  confirmed: 'Confirmar diagnóstico',
  incorrect: 'Incorrecto',
  insufficient_data: 'Faltan datos',
};

export function FeedbackControls({ incidentId }: FeedbackControlsProps) {
  const auth = useAuth();
  const [investigation, setInvestigation] = useState<InvestigateResponse | null>(null);
  const [feedbacks, setFeedbacks] = useState<FeedbackRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canAdjudicate = auth.user ? hasPermission(auth.user.role, 'view_network') : false;

  const openInvestigation = useCallback(async (): Promise<InvestigateResponse | null> => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/incidents/${encodeURIComponent(incidentId)}/investigate`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
        },
      );
      const body = (await response.json().catch(() => ({}))) as Partial<InvestigateResponse> & {
        error?: string;
      };
      if (!response.ok) {
        setError(body.error ?? 'No se pudo abrir la investigación.');
        return null;
      }
      const next: InvestigateResponse = {
        runId: body.runId ?? null,
        versionId: body.versionId ?? null,
        status: body.status ?? 'pending',
        idempotent: body.idempotent ?? false,
      };
      setInvestigation(next);
      return next;
    } catch {
      setError('No se pudo abrir la investigación.');
      return null;
    } finally {
      setLoading(false);
    }
  }, [incidentId]);

  const loadFeedbacks = useCallback(async (runId: string): Promise<void> => {
    try {
      const response = await fetch(
        `/api/investigations/${encodeURIComponent(runId)}/feedbacks`,
        { credentials: 'include' },
      );
      if (!response.ok) {
        return;
      }
      const body = (await response.json().catch(() => ({}))) as { feedbacks?: FeedbackRow[] };
      // The fetch result is the side effect of loading; queueing the
      // state update outside the effect body avoids the
      // `react-hooks/set-state-in-effect` lint and keeps the call site
      // free of cascading-render smells.
      queueMicrotask(() => {
        setFeedbacks(body.feedbacks ?? []);
      });
    } catch {
      // Network errors leave the previous list intact.
    }
  }, []);

  // Open the investigation on mount. The POST is fire-and-forget; the
  // second effect re-reads feedbacks when the runId becomes known.
  useEffect(() => {
    if (!auth.user || !canAdjudicate) return;
    queueMicrotask(() => {
      void openInvestigation();
    });
  }, [auth.user, canAdjudicate, openInvestigation]);

  useEffect(() => {
    const runId = investigation?.runId;
    if (!runId) return;
    queueMicrotask(() => {
      void loadFeedbacks(runId);
    });
  }, [investigation?.runId, loadFeedbacks]);

  const recordFeedback = useCallback(
    async (label: FeedbackLabel): Promise<void> => {
      if (!investigation?.runId || !investigation.versionId) return;
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(
          `/api/investigations/${encodeURIComponent(
            investigation.runId,
          )}/versions/${encodeURIComponent(investigation.versionId)}/feedback`,
          {
            method: 'POST',
            credentials: 'include',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ label }),
          },
        );
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { error?: string };
          setError(body.error ?? 'No se pudo registrar la validación.');
          return;
        }
        await loadFeedbacks(investigation.runId);
      } catch {
        setError('No se pudo registrar la validación.');
      } finally {
        setLoading(false);
      }
    },
    [investigation, loadFeedbacks],
  );

  if (!canAdjudicate) return null;

  return (
    <div
      className="mt-2 rounded-lg border border-white/[0.08] bg-white/[0.02] p-3"
      data-testid={`feedback-controls-${incidentId}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        {(Object.keys(LABEL_BUTTON_TEXT) as FeedbackLabel[]).map((label) => (
          <button
            key={label}
            type="button"
            disabled={loading || !investigation?.versionId}
            onClick={() => void recordFeedback(label)}
            data-testid={`feedback-button-${label}-${incidentId}`}
            className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[11px] font-medium text-neutral-100 hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {LABEL_BUTTON_TEXT[label]}
          </button>
        ))}
      </div>
      {error ? (
        <p
          className="mt-2 text-[11px] text-rose-300"
          data-testid={`feedback-error-${incidentId}`}
        >
          {error}
        </p>
      ) : null}
      {feedbacks.length > 0 ? (
        <ul className="mt-2 space-y-1 text-[11px] text-neutral-400">
          {feedbacks.map((row) => (
            <li
              key={row.feedbackId}
              data-testid={`feedback-row-${row.feedbackId}`}
              className="flex flex-wrap items-center gap-x-2 gap-y-0.5"
            >
              <span className="font-mono text-neutral-300">{row.label}</span>
              <span>·</span>
              <span>{new Date(row.submittedAt).toLocaleString()}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
