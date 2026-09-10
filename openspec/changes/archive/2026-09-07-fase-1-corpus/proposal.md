# Fase 1 PR #6 — Frozen investigation feedback corpus

## Why

Gate 1 of the cognitive-investigation roadmap requires a frozen
initial corpus of adjudicated cases. The report the eval nightly
leg produces is bounded below by this corpus; without it, the
precision number is invented rather than measured.

## What changes

- `packages/eval/tests/fixtures/investigation-corpus.ts` (new):
  35 cases (25 confirmed + 5 incorrect + 5 insufficient_data), frozen
  in a `Readonly` envelope, with `assertInvestigationCorpusFloor` as
  the canonical floor gate.
- `packages/eval/tests/investigation-corpus.test.ts` (new):
  11 tests pinning fixture integrity, the precision contract
  integration with `computeFeedbackSummary`, and explicit floor
  violations.

## Out of scope

- The eval nightly leg that consumes the corpus (different package,
  different spec change).
- Live adjudication ingestion (covered by Fase 1 PR #2 API).
