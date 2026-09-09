# Fase 3 PR #1 — Investigation result contract

## Why

Roadmap Fase 3 (3.1). Authoritative envelope the investigation
engine produces and the UI renders. Closed, size-bounded; no
calibration-free confidence numbers.

## What changes

- `packages/shared/src/contracts.ts`: new section with
  `ftth.investigation-result.v1` envelope + building blocks +
  size constants + closed enums.
- `packages/shared/tests/contracts-investigation-result.test.ts`
  (new): 19 tests pinning the discipline.

## Out of scope

- Investigation engine that produces the envelope (Fase 3 PR #2).
- Persistence (Fase 3 PR #3).
- UI (Fase 3 PR #5).
