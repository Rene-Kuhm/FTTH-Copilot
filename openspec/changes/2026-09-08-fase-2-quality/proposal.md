# Fase 2 PR #1 — Evidence quality primitives

## Why

Roadmap Fase 2 (2.1 + 2.2 + 2.3 + 2.4 + 2.5). A quality layer is the
prerequisite for distinguishing vigente, insuficiente y vencida in
every diagnostic; without it, the investigation engine has no way
to refuse to speak when the evidence stream is broken.

## What changes

- `packages/evidence/src/evidence-quality.ts` (new, pure):
  - `SourcePolicy` + `DEFAULT_SOURCE_POLICIES` (3 families).
  - `assessFreshness(samples, policy, nowMs)` returns `QualityResult`.
  - `detectCounterReset(samples)` returns the index of the first
    backwards numeric jump, or null.
  - `isMissingValue(sample, numeric)` for valores ausentes.
  - `toQualityVerdict({toolName, result})` → existing `Verdict`
    shape (TruthGate bridge, no schema change).
- `packages/evidence/src/index.ts`: re-exports.
- `packages/evidence/tests/evidence-quality.test.ts` (new):
  the eight required scenarios from roadmap Fase 2 + the bridge.

## Out of scope

- agent-core integration of quality signals (Fase 2 PR #2).
- Scheduler health checks (Fase 2 PR #3).
- Persistence on MetricSample rows (Fase 3).
