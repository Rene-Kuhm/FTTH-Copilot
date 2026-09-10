# Fase 1 PR #5 — Investigation feedback export to packages/eval

## Why

Gate 1 of the cognitive-investigation roadmap requires a reproducible
report with a denominator, adjudicated cases, and pending cases. The
report must show insufficiency (never invent precision) when the
sample size is below the documented threshold.

This PR delivers the conversion function and aggregator that the
nightly eval leg consumes. It does NOT modify the VerdictLog schema
— feedback is a different kind of evidence and must be routed
separately.

## What changes

- `packages/eval/src/feedback-export.ts` (new):
  - `FEEDBACK_TO_VERDICT_CODE` (closed, exhaustive):
    `confirmed → ok`, `incorrect → low_confidence`,
    `insufficient_data → incomplete`.
  - `investigationFeedbackExportSchema` (`.strict()` Zod envelope,
    schema literal `ftth.investigation-feedback-export.v1`).
  - `toInvestigationFeedbackExport` / `toInvestigationFeedbackExportBatch`
    pure converters.
  - `computeFeedbackSummary` aggregator with the precision contract.
  - `minSampleSize` configurable per call.
- `packages/eval/src/index.ts`: re-exports the helpers above.
- `packages/eval/tests/feedback-export.test.ts`: 22 tests.

## Out of scope

- VerdictLog writes from feedback. The nightly leg is the owner;
  this PR ships the conversion primitive.
- Corpus etiquetado ≥30 (PR #6 of Fase 1).
