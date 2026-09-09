# Fase 3 PR #4 — Server-side investigation reference & temporal validator

## Why

Roadmap Fase 3 (3.4): "Validar del lado servidor cada referencia, alcance temporal
y pertenencia; comprobar que cifras estructuradas correspondan a la evidencia.
Referencias inventadas, números contradictorios o JSON inválido MUST producir salida
segura con faltantes."

Following PR #120 (`ftth.investigation-result.v1` contract), PR #123 (evidence collector),
and PR #124 (deterministic facts & cognitive engine), the investigation result must be
validated independently by a server-side gate before persistence (PR #5 / 3.5) and
API serving (PR #6 / 3.6).

The server validator guarantees:
1. Tenant ownership: every evidence reference belongs strictly to the authorized `tenantId`.
2. Temporal bounds: every reference's `observedAt` falls within `[windowStart, windowEnd]`.
3. Citation authenticity: all `forRefIds`, `againstRefIds`, and contradiction pointers
   resolve to verified, authoritative evidence references.
4. Numerical consistency: figures mentioned in hypotheses align with underlying telemetry.
5. Safe degraded output: corrupted references, hallucinations, or malformed JSON
   never crash the system, but produce a safe compliant envelope with explicit missing items.

## What changes

- `packages/agent-core/src/investigation-validator.ts` (new):
  - Pure function `validateInvestigationResult(result, context)`:
    - Verifies schema, tenant isolation, and window bounds.
    - Validates citations and detects hallucinated or cross-tenant references.
    - Verifies numerical alignment between structured metrics and hypothesis summaries.
    - Returns validation report `{ isValid: boolean; issues: ValidationIssue[]; sanitizedResult: InvestigationResult }`.
  - Function `buildSafeFallbackResult(args)` to construct a guaranteed valid envelope with missing indicators.
- `packages/agent-core/src/index.ts`:
  - Re-exports validator functions, types, and error classes.
- `packages/agent-core/tests/investigation-validator.test.ts` (new):
  - Test suite covering cross-tenant rejection, out-of-bounds timestamps, citation pruning,
    numerical discrepancy detection, and fallback synthesis.

## Out of scope

- Database persistence into `InvestigationVersion.snapshotJson` (Fase 3 PR #5 / 3.5).
- HTTP API route `/api/incidents/[id]/investigate` (Fase 3 PR #6 / 3.6).
- UI investigation dashboard card (Fase 3 PR #7 / 3.7).
