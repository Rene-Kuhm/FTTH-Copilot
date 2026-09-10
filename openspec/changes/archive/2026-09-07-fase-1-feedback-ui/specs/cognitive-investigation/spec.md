# Fase 1 PR #4 — UI: feedback controls (spec delta)

## Why

The cognitive-investigation feedback API (Fase 1 PR #2) and the
optional link on ConfirmedIncident (Fase 1 PR #3) require a UI
surface for the operator. Without it the feedback schema and the
API are not reachable by the technician, and the Gate 1 acceptance
criterion (`un técnico puede evaluar un diagnóstico y recuperar esa
evaluación`) is not met.

This PR ships the minimum UI surface:
  - `FeedbackControls` component on each incident row.
  - `POST /api/incidents/:id/investigate` route that opens or reuses
    a run + creates the first InvestigationVersion placeholder.
  - Three buttons that record the operator's adjudication.

The placeholder version is empty until Fase 3 (investigate engine
itself) is implemented. The contract is stable: when Fase 3
replaces the placeholder with a real diagnostic, the UI keeps
posting feedback against the current versionId returned by the
investigate endpoint.

## What changes

- `apps/web/components/FeedbackControls.tsx` (new): client component.
  Mounts an InvestigationRun if needed, then renders the 3 buttons
  + the existing feedback history for the run.
- `apps/web/components/IncidentsPanel.tsx`: import + render the new
  component per row, gated on `view_network`.
- `apps/web/app/api/incidents/[id]/investigate/route.ts` (new):
  POST endpoint that opens an InvestigationRun (idempotent by
  `(tenantId, incidentId)`) and writes a single InvestigationVersion
  at `versionIndex = 0` with `snapshotJson = { incident: { ... } }`.
- `apps/web/tests/api/investigate-route.test.ts`: 8 vitest tests.
- `apps/web/e2e/feedback-controls.spec.ts`: 2 Playwright tests that
  drive the UI buttons and assert the rendered feedback history.

## Scenarios (Given/When/Then)

### Scenario: operator opens an investigation for an incident

Given an incident I is rendered on the operator's dashboard
When the FeedbackControls component mounts
Then the component MUST POST `/api/incidents/I/investigate` to open or
reuse a run+version
And the component MUST show the three buttons once the runId is known

### Scenario: operator records a confirmed feedback

Given the FeedbackControls rendered the three buttons for incident I
When the operator clicks "Confirmar diagnóstico"
Then the component MUST POST to
`/api/investigations/:runId/versions/:versionId/feedback`
with `{ label: 'confirmed' }`
And the component MUST refresh the feedback history from
`/api/investigations/:runId/feedbacks`
And the new row MUST appear in the timeline

### Scenario: server error surfaces inline (no throw)

Given the FeedbackControls made a POST that returned 404
When the response body is `{ error: '...' }`
Then the component MUST render the error message inline (data-testid
`feedback-error-{incidentId}`) without crashing

### Scenario: FeedbackControls hidden for users without view_network

Given the operator lacks `view_network`
When the IncidentsPanel renders
Then the FeedbackControls MUST NOT render any DOM for that user

## Rules (RFC 2119)

- The component MUST NOT persist any client-supplied runId or
  versionId; it derives both from the server responses.
- The component MUST NOT trigger any network request without
  `view_network`.
- The placeholder InvestigationVersion snapshot MUST be empty
  enough to round-trip JSON; no real evidence is collected in Fase 1.
- A future change that introduces a real evidence pipeline MUST keep
  the POST `/api/incidents/:id/investigate` contract stable so this
  UI does not need to change.
