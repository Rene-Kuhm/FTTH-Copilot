# Fase 3 PR #2 — Cognitive investigation evidence collector

## Why

Roadmap Fase 3 (3.2): "Reunir evidencia desde fuentes autorizadas en
`packages/evidence`. Recuperar historial confirmado como contexto, no como
prueba de la causa actual."

Following PR #120 (`ftth.investigation-result.v1` envelope definition), we now
need the deterministic evidence collector in `@ftth-copilot/evidence`. The
collector assembles structured evidence references (`InvestigationEvidenceRef[]`)
from authorized telemetry (metrics), device syslog events, network topology hops,
past feedback, and confirmed incident history.

It enforces strict multi-tenant isolation, temporal window bounding (≤30 days),
size caps (≤64 evidence refs), quality assessment via `evidence-quality`, and
explicit contextual tagging of historical incidents (context, never proof).

## What changes

- `packages/evidence/src/evidence-collector.ts` (new):
  - Pure function `collectInvestigationEvidence(args)` (Prisma-free, pure TS).
  - Normalizes and bounds evidence into `InvestigationEvidenceRef[]`.
  - Assesses telemetry quality (`fresh`, `stale`, `insufficient`, `unknown`).
  - Tags historical confirmed incidents with explicit `[Contexto Histórico]`.
  - Rejects cross-tenant records strictly.
  - Limits total refs to `MAX_INVESTIGATION_EVIDENCE_REFS` (64).
- `packages/evidence/src/index.ts`:
  - Re-exports collector types and functions.
- `packages/evidence/tests/evidence-collector.test.ts` (new):
  - Unit tests covering tenant isolation, time window filtering, cap enforcement,
    quality evaluation, historical context demarcation, and deterministic ordering.

## Out of scope

- LLM prompt generation and hypothesis synthesis (Fase 3 PR #3 / 3.3).
- Server-side reference validation and consistency checking (Fase 3 PR #4 / 3.4).
- Database persistence on `InvestigationVersion.snapshotJson` (Fase 3 PR #5 / 3.5).
- Web route `/api/incidents/[id]/investigate` and UI cards (Fase 3 PR #6-7 / 3.6-3.7).
