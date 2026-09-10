# Fase 1 — Validación humana y dataset evaluable (spec delta)

## Why

La función **Investigar incidente** (ver `docs/roadmap-investigacion-cognitiva.md`)
requiere que un técnico pueda evaluar un diagnóstico concreto. Sin
adjudicación versionada no hay forma de medir precisión del diagnóstico,
ni de construir un corpus etiquetado para cerrar la fase 7. Esta fase
añade el modelo de persistencia y los contratos de feedback; las rutas
API se entregan en PRs separados posteriores.

## What changes

- `packages/db/prisma/schema.prisma`: tres tablas nuevas
  (`investigation_runs`, `investigation_versions`,
  `investigation_feedback`) con FKs suaves (no se borra evidencia
  en cascada) y un índice único por `(tenantId, runId, versionId,
  authorUserId, label)` que sirve como huella de idempotencia.
- Migración aditiva `20260907140000_investigation_run_version_feedback/`.
- `packages/db/tests/investigation-model.test.ts`: 6 tests RED → verde
  ejercitando el modelo contra Postgres real (skip si no hay DB).

## Identity contract (extiende Fase 0)

El contrato `ftth.investigation-feedback.v1` se usa para los cuerpos
de POST /api/incidents/[id]/versions/[versionId]/feedback en PRs
posteriores. Esta fase añade el campo opcional `realCause`,
`observations` y `resolutionEvidence` que serán exigidos en fase 3.
La enumeración de `label` se cierra en esta fase como
`'confirmed' | 'incorrect' | 'insufficient_data'` y NO se extiende
sin una migración explícita.

## Scenarios (Given/When/Then)

### Scenario: a tenant cannot see another tenant's feedback

Given an investigation feedback exists for tenant A with `feedbackId: 'f_a'`
When tenant B queries `tenantId_feedbackId = { tenantId: 'B', feedbackId: 'f_a' }`
Then the lookup MUST return null (the unique key includes `tenantId`)

### Scenario: duplicate submission collapses to one row (idempotency)

Given a technician submitted `confirmed` for version V at 10:00
When the same technician submits `confirmed` for version V at 10:05
Then the second submission MUST collapse to the same row
And the API MUST return the existing row, not create a duplicate
And the @@unique constraint MUST prevent the duplicate at the DB level

### Scenario: feedback survives version deletion (no cascade)

Given a feedback references version V via `versionRefId`
When version V is deleted
Then the feedback row MUST persist with `versionRefId = NULL`
And the `runId` and `versionId` columns (denormalized) MUST remain set
so a later audit can identify the orphaned feedback

### Scenario: feedback survives incident deletion (no FK)

Given a feedback was created while incident I existed
When incident I is deleted (no FK from InvestigationFeedback to Incident)
Then the feedback row MUST persist (incidentId is a soft column,
not a Prisma relation)
And the API MUST continue to return the feedback under
GET /api/incidents/[id]/feedbacks where `[id]` is the runId

### Scenario: feedback label is locked to the three-value enum

Given a technician submits feedback with `label: 'maintenance'`
When the API receives the body
Then the API MUST reject with 400 and a `invalid_label` error code
And no row is written to `investigation_feedback`
(Phase 5 may extend the label set via a separate spec change that
includes a Prisma migration.)

### Scenario: cross-tenant runId collision is allowed in the DB

Given tenant A has a run with `runId: 'r_42'`
When tenant B creates a run with `runId: 'r_42'`
Then both rows MUST exist (the @@unique is per-tenant)
And the API MUST resolve them only via `tenantId` lookups

## Rules (RFC 2119)

- The label enum is closed in this spec: `confirmed` | `incorrect` |
  `insufficient_data`. Extensions require a separate spec change that
  includes a Prisma migration.
- The idempotency fingerprint is `(tenantId, runId, versionId,
  authorUserId, label)`. The API MUST return the existing row on
  duplicate submission.
- The retention policy from `docs/security/retention-and-redaction.md`
  MUST hold: a feedback row is never deleted to roll back a feature.
- The `feedbackId` field is opaque and MUST NOT be derived from the
  Prisma row id. The API MUST generate it server-side via the shared
  identifier contract.
