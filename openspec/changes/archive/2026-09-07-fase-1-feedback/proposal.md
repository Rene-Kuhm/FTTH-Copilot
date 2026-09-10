# Fase 1 — Validación humana y dataset evaluable

## Why

La función **Investigar incidente** (ver `docs/roadmap-investigacion-cognitiva.md`)
requiere que un técnico pueda evaluar un diagnóstico concreto. Sin
adjudicación versionada no hay forma de medir precisión del diagnóstico,
ni de construir un corpus etiquetado para cerrar la fase 7.

## What changes

- `packages/db/prisma/schema.prisma`: tres tablas nuevas
  (`investigation_runs`, `investigation_versions`,
  `investigation_feedback`) con FKs suaves y un índice único por
  `(tenantId, runId, versionId, authorUserId, label)` que sirve como
  huella de idempotencia.
- Migración aditiva
  `20260907140000_investigation_run_version_feedback/migration.sql`.
- `packages/db/tests/investigation-model.test.ts`: 6 tests
  integration que pinean:
    - creación de run/version/feedback con IDs opacos;
    - aislamiento entre tenants (mismo `feedbackId`, distinto tenant);
    - deduplicación idempotente del feedback;
    - persistencia del run al borrar la versión (`SetNull`, no cascade);
    - unicidad `(tenantId, runId)`;
    - mismo `runId` en dos tenants distintos (colisión controlada).

## Out of scope (PRs separados en esta fase)

- API de lectura/escritura (`GET/POST /api/incidents/.../feedbacks`).
- Integración con `ConfirmedIncident` (no promueve automáticamente).
- Controles UI en la ficha del incidente.
- Exportación compatible con `packages/eval` (mapeo a `VerdictLog`).
- Corpus etiquetado (≥30 casos adjudicados; ≥5 insuficientes; ≥5 incorrectos).

## Risks

- **Cascada accidental**: si una FK se declara con `onDelete: Cascade` por
  error, un `DELETE Incident` borra la historia de investigación. El
  modelo usa `SetNull` explícito en todas las FKs blandas.
- **Label expansion**: si una PR futura añade `'maintenance'` sin
  migración, los inserts fallarán en runtime. El spec delta cierra el
  enum; la migración lo hace explícito.

## Rollback

- `DROP TABLE investigation_feedback, investigation_versions,
  investigation_runs CASCADE;` (la migración se marca como reversible).
- El cliente Prisma exporta automáticamente los modelos; sin un
  `prisma generate` nuevo, código viejo sigue compilando.
