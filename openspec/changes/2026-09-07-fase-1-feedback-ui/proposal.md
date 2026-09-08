# Fase 1 PR #4 — UI: feedback controls on incident rows

## Why

The feedback API + persistence + promotion link are useless without
a UI surface. Gate 1 of the cognitive-investigation roadmap requires
that "un técnico puede evaluar un diagnóstico y recuperar esa
evaluación"; this PR delivers the minimum UI to do exactly that.

## What changes

- `apps/web/components/FeedbackControls.tsx` (new client component)
  renders 3 buttons + the existing feedback history per incident row.
- `apps/web/components/IncidentsPanel.tsx`: imports + renders the
  FeedbackControls (gated on `view_network`).
- `apps/web/app/api/incidents/[id]/investigate/route.ts` (new POST):
  opens an InvestigationRun (idempotent on `(tenantId, incidentId)`)
  with a single InvestigationVersion at `versionIndex = 0` whose
  snapshot carries the incident reference. This is the Fase 1
  placeholder: the real evidence pipeline ships in Fase 3. The
  route is stable so the UI does not need to change later.
- `apps/web/tests/api/investigate-route.test.ts`: 8 vitest tests
  covering the permission gate, cross-tenant lookup, happy path,
  and idempotent retry.
- `apps/web/e2e/feedback-controls.spec.ts`: 2 Playwright tests that
  drive the UI through a real browser flow (no mocks for the new
  feedback routes; only the auth/incidents/topology routes are
  mocked).

## Out of scope

- Real evidence collection (Fase 3).
- Evaluation export to packages/eval (Fase 1 PR #5).
- Corpus etiquetado ≥30 (Fase 1 PR #6).
