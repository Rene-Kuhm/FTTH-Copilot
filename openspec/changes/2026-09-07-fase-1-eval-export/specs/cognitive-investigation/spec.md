# Fase 1 PR #5 — Investigation feedback export to packages/eval (spec delta)

## Why

The cognitive-investigation feedback (Fase 1 PR #1 + #2) is now
persisted on InvestigationFeedback rows. Gate 1 of the roadmap
requires that "la evaluación produce un reporte con denominador,
casos etiquetados y pendientes. Si faltan etiquetas, MUST mostrar
insuficiencia, nunca precisión inventada."

This PR delivers the conversion function + aggregator that the
nightly eval leg consumes. It does NOT modify the VerdictLog
schema (the spec rule 1.6 says "feedback de diagnóstico no equivale
automáticamente a etiquetas de todas sus afirmaciones" — meaning a
`confirmed` feedback is one piece of evidence, not a label for every
claim in the diagnostic). The export uses its own envelope
(`ftth.investigation-feedback-export.v1`) tagged with a `source`
discriminator so consumers can route it separately from VerdictLog
rows.

## What changes

- `packages/eval/src/feedback-export.ts` (new):
  - `FEEDBACK_TO_VERDICT_CODE` mapping table (closed, exhaustively
    covered): `confirmed → ok`, `incorrect → low_confidence`,
    `insufficient_data → incomplete`.
  - `investigationFeedbackExportSchema` (`.strict()` Zod envelope,
    schema literal `ftth.investigation-feedback-export.v1`) carrying
    the mapping plus the provenance fields (feedbackId, runId,
    versionId, tenantId, authorUserId, observedAt).
  - `toInvestigationFeedbackExport` / `toInvestigationFeedbackExportBatch`
    pure converters (no DB, no I/O).
  - `computeFeedbackSummary` aggregator returning the precision
    numerator only when the sample size meets the documented
    threshold (`DEFAULT_MIN_SAMPLE_SIZE = 30`).
  - `minSampleSize` configurable per call so a tenant can use a
    tighter threshold while the dataset grows.
- `packages/eval/src/index.ts`: re-exports the helpers above.
- `packages/eval/tests/feedback-export.test.ts`: 22 tests pinning the
  closed enum, the conversion table, the strict envelope, the
  aggregator's precision contract (null below threshold, excluding
  `insufficient_data` from the denominator), and the discriminator.

## Mapping table (locked)

| Feedback label     | VerdictCode       | Rationale |
|--------------------|-------------------|-----------|
| `confirmed`        | `ok`              | Technician agrees the diagnostic is correct. |
| `incorrect`        | `low_confidence`  | VerdictLog has no `incorrect` code; `low_confidence` is the closest existing code. The export envelope carries `label: 'incorrect'` so a downstream consumer can distinguish a feedback `incorrect` from a real `low_confidence` via the `source: 'investigation-feedback'` discriminator. |
| `insufficient_data`| `incomplete`      | Verbatim mapping; `incomplete` is the existing VerdictCode for "not enough data". |

The mapping is exhaustive. Adding a feedback label requires a
schema change to `FEEDBACK_LABELS` (and consequently a change to
`FEEDBACK_TO_VERDICT_CODE` and a migration if the database enum
extends). The schema is closed for Fase 1.

## Scenarios (Given/When/Then)

### Scenario: a `confirmed` feedback maps to `ok`

Given a row with `label = 'confirmed'`
When the exporter produces the envelope
Then `mappedCode = 'ok'` and `label = 'confirmed'` (both preserved)

### Scenario: an `incorrect` feedback maps to `low_confidence` (NOT `ok`)

Given a row with `label = 'incorrect'`
When the exporter produces the envelope
Then `mappedCode = 'low_confidence'`
And `mappedCode !== 'ok'`
And the consumer can distinguish the entry from a real
`low_confidence` VerdictLog row via `source: 'investigation-feedback'`

### Scenario: precision is null below the threshold

Given 28 confirmed + 1 incorrect feedback rows (29 evaluated)
When `computeFeedbackSummary` is called with the default threshold
Then `precision === null`
And `isCalibrated === false`
And `total === 29`

### Scenario: precision excludes insufficient_data from the denominator

Given 25 confirmed + 5 incorrect + 100 insufficient_data rows
When `computeFeedbackSummary` is called
Then `precision === 25 / 30` (evaluated = confirmed + incorrect = 30,
NOT 130)
And `insufficient_data === 100`

### Scenario: precision is null when only insufficient_data rows are present

Given 100 `insufficient_data` rows
When `computeFeedbackSummary` is called
Then `precision === null`
And the eval nightly report MUST surface "insuficiencia de datos",
not a precision number

### Scenario: empty batch

Given an empty batch
When `computeFeedbackSummary` is called
Then `total === 0`, `evaluated === 0`, `precision === null`,
`isCalibrated === false`

## Rules (RFC 2119)

- The mapping is closed and exhaustive. Adding a feedback label
  requires a separate spec change that includes a database migration
  and a re-test of this module.
- The envelope is `.strict()`. Producers MUST NOT widen the wire
  format silently; any new field requires a schema literal bump.
- `precision` MUST be `null` when the sample size is below the
  threshold (default 30). The eval nightly leg MUST surface this as
  "insuficiencia" in the report, NEVER as a precision number.
- `insufficient_data` MUST NOT contribute to the precision
  denominator. The denominator is `confirmed + incorrect` only.
- The export envelope is NOT a VerdictLog row. The nightly leg
  filters on `source === 'investigation-feedback'` to route it
  separately.
