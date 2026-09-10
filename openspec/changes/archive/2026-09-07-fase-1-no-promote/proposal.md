# Fase 1 PR #3 — Optional feedback link on ConfirmedIncident

## Why

The cognitive-investigation feedback (Fase 1 PR #1 + #2) is now
persisted and addressable via the API. The promotion path
(`/api/incidents/:id/confirm`) writes to `ConfirmedIncident`. This
PR adds an optional `investigationFeedbackId` link so audit can
recover which technician adjudication motivated the promotion —
without changing the promotion contract.

The roadmap rule 1.4 (`Confirmar una hipótesis no debe promover
automáticamente un incidente aún abierto`) is preserved: only the
operator's explicit POST to `/confirm` promotes; a `confirmed`
feedback is at most a *citation*.

## What changes

- `packages/db/prisma/schema.prisma`:
  - new column `investigationFeedbackId String?` on ConfirmedIncident
    (soft reference; no FK so a feedback deletion does not cascade into
    the immutable KB).
  - new `@@index([tenantId, investigationFeedbackId])`.
- `packages/db/prisma/migrations/20260907141000_add_investigation_feedback_id_to_confirmed/`:
  additive migration; drops the column on rollback.
- `apps/web/app/api/incidents/[id]/confirm/route.ts`:
  - body schema accepts optional `investigationFeedbackId`.
  - new lookup validates `(tenantId, feedbackId)` in caller's tenant.
  - `incorrect` / `insufficient_data` labels rejected with 409.
  - linked row uses `sourceTool = '__investigation_confirm__'`.
- `apps/web/tests/api/incidents-confirm.test.ts`:
  +7 new tests covering the link, the negative-label rejection, the
  cross-tenant rejection, and the unchanged legacy path.

## Out of scope

- UI for the link (Fase 1 PR #4).
- Evaluation export (Fase 1 PR #5).
- Auto-promotion: explicitly forbidden.
