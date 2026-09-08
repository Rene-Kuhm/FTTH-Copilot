# Fase 1 PR #3 — Optional feedback link on ConfirmedIncident (spec delta)

## Why

The cognitive-investigation feedback (Fase 1 PR #1 + #2) is now
persisted and addressable via the API. The promotion path
(`/api/incidents/:id/confirm`) is the existing operator-driven
flow that writes to `ConfirmedIncident`. The two systems must
co-exist without changing the promotion contract:
- A `confirmed` feedback can be **linked** to a `ConfirmedIncident`
  so audit can recover which technician adjudication motivated the
  promotion.
- A negative feedback (`incorrect` / `insufficient_data`) MUST NOT
  promote. The application rejects the link with 409.
- An unknown or cross-tenant feedbackId MUST be rejected (404) so
  the immutable KB is free of orphan references.

## What changes

- `packages/db/prisma/schema.prisma`:
  - new column `investigationFeedbackId String?` on ConfirmedIncident
    (no FK; soft reference; application-layer tenant scoping).
  - new `@@index([tenantId, investigationFeedbackId])`.
- `packages/db/prisma/migrations/20260907141000_add_investigation_feedback_id_to_confirmed/migration.sql`:
  additive `ALTER TABLE ... ADD COLUMN` + index. Down migration drops
  the column and the index.
- `apps/web/app/api/incidents/[id]/confirm/route.ts`:
  - body schema accepts optional `investigationFeedbackId` (1..128 chars).
  - new lookup validates `(tenantId, feedbackId)` in the caller's tenant
    (404 on miss).
  - negative feedback labels are rejected with 409 and a `feedbackLabel`
    hint so the UI can tell the operator which feedback blocked the
    promotion.
  - when a `confirmed` feedback is linked, the row is persisted with
    `investigationFeedbackId = <feedbackId>` and `sourceTool =
    '__investigation_confirm__'` (vs `'__operator_confirm__'` for the
    unlinked path). The `AgentActionLog` row carries the same distinction
    so audit can distinguish a regular operator confirm from one that
    started as an investigation adjudication.
  - promotion conditions (`incident.status === 'resolved'`, idempotency
    by sourceIncidentId) are unchanged.

## Scenarios (Given/When/Then)

### Scenario: confirmed feedback can be linked

Given a technician submitted `confirmed` feedback for some version V
of investigation R, and an incident I (resolved)
When the operator POSTs `/api/incidents/I/confirm` with
`investigationFeedbackId = f_linked`
Then the ConfirmedIncident row MUST persist with
`investigationFeedbackId = 'f_linked'` and `sourceTool =
'__investigation_confirm__'`

### Scenario: negative feedback MUST NOT promote

Given a technician submitted `incorrect` feedback
When the operator POSTs confirm with that feedbackId
Then the API MUST return 409
And no ConfirmedIncident row is written
And the response includes `feedbackLabel: 'incorrect'` so the UI can
explain the rejection

### Scenario: insufficient_data feedback MUST NOT promote

Same as above for label = 'insufficient_data'.

### Scenario: cross-tenant feedback link is rejected

Given a feedbackId owned by tenant B
When a tenant A operator POSTs confirm with that feedbackId
Then the API MUST return 404
And no ConfirmedIncident row is written
(404, not 403, to avoid leaking the existence of B's feedback)

### Scenario: feedback link is optional

When the operator POSTs confirm without `investigationFeedbackId`
Then the promotion flow is unchanged: `investigationFeedbackId = NULL`,
`sourceTool = '__operator_confirm__'`, no extra DB reads

### Scenario: existing promotion path is preserved

When a tenant operator confirms an incident without a feedback link
Then the route MUST NOT regress: same response shape, same idempotency,
same `AgentActionLog` semantics as before this PR.

## Rules (RFC 2119)

- A `confirmed` feedback is the ONLY label that can be linked to a
  `ConfirmedIncident`. The route MUST return 409 for `incorrect` and
  `insufficient_data`.
- The `(tenantId, feedbackId)` lookup MUST use `user.tenantId`; the
  client MUST NOT be able to influence it.
- The legacy `__operator_confirm__` flow MUST NOT change. Existing
  ConfirmedIncident rows (without `investigationFeedbackId`) stay
  unaffected (column is NULL).
- A future PR that introduces additional promotion labels for the
  investigation feedback MUST update both this spec and the route
  test under a separate spec change.

## Out of scope

- UI surface for the link (covered by Fase 1 PR #4).
- Evaluation export (Fase 1 PR #5).
- Auto-promotion on `confirmed` (explicitly forbidden by the roadmap
  rule 1.4 and by the `confirmed` feedback schema in Fase 1 PR #1).
