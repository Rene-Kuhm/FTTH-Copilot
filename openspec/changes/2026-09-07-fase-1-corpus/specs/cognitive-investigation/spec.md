# Fase 1 PR #6 — Frozen investigation feedback corpus (spec delta)

## Why

Gate 1 of the cognitive-investigation roadmap requires the eval
nightly leg to produce a report with denominator, adjudicated cases,
and pending cases. The corpus is the **ground truth** the report
runs against. Without a frozen calibration corpus the precision
number the report surfaces is meaningless.

The spec rule 1.7 says:
"Congelar un corpus inicial etiquetado, separado de los ejemplos
usados en desarrollo. Registrar desacuerdos y resolución de
etiquetas."

## What changes

- `packages/eval/tests/fixtures/investigation-corpus.ts` (new):
  - 35 adjudicated cases (25 confirmed + 5 incorrect + 5
    insufficient_data) with stable case ids
    (`cog-feedback-NNN`), `incidentRef` cross-references,
    `adjudicatedBy`, `adjudicatedAt`, and optional notes.
  - Locked `INVESTIGATION_CORPUS_SCHEMA = 'ftth.investigation-corpus.v1'`
    + version `1`.
  - `assertInvestigationCorpusFloor` throws when the floor
    (≥30 total, ≥5 per label) is breached.
  - `loadInvestigationCorpus` defensive-copy loader for consumers
    that need a mutable view.
  - The exported corpus is typed as `Readonly<InvestigationCorpus>` so
    a producer cannot accidentally mutate the calibration data.
- `packages/eval/tests/investigation-corpus.test.ts` (new):
  - Fixture integrity (schema/version/floor/case-id uniqueness/
    ISO datetime validation/frozen mutation).
  - Precision contract integration with `computeFeedbackSummary` (the
    fixture meets the default threshold; dropping a confirmed case
    drops the precision to null below threshold).
  - Explicit floor violations (total < 30, label below the floor,
    duplicate caseId, unknown label).

## Composition rationale

- 25 confirmed / 5 incorrect / 5 insufficient_data = 30 evaluated
  cases. This is exactly the `DEFAULT_MIN_SAMPLE_SIZE` for the
  precision contract.
- Real production mix is heavy on `confirmed` (the technician agrees
  with most diagnostics) and light on `incorrect` /
  `insufficient_data`. The 25/5/5 split reflects a healthy
  production dataset; the spec floor is 5/5/5 minimums.
- The dataset is FROZEN — any change ships under a new schema
  literal. The expected behavior is "the precision reported by the
  nightly leg is bounded below by this corpus, never below".

## Scenarios (Given/When/Then)

### Scenario: the corpus meets the spec floor

Given the fixture has 35 cases (25 confirmed + 5 incorrect + 5
insufficient_data)
When `assertInvestigationCorpusFloor` runs
Then it MUST NOT throw

### Scenario: dropping a confirmed case below threshold collapses precision to null

Given the fixture has 30 evaluated cases
When 24 of the confirmed cases are removed (evaluated = 6)
And the corpus is fed into `computeFeedbackSummary`
Then `precision === null`
And `isCalibrated === false`

### Scenario: precision excludes insufficient_data from the denominator

Given the corpus has 25 confirmed + 5 incorrect + 5 insufficient_data
When `computeFeedbackSummary` runs
Then `precision = 25/30` (NOT 25/35)
And `insufficient_data = 5` is reported separately

### Scenario: the corpus is immutable at the type level

Given `INVESTIGATION_CORPUS` is typed `Readonly<InvestigationCorpus>`
When a producer tries to push to its cases
Then the type-checker MUST reject the operation
And the runtime object is also frozen via the `ReadonlyArray` cast

## Rules (RFC 2119)

- The corpus is frozen. Any change ships under a new schema literal
  (e.g. `ftth.investigation-corpus.v2`) and a separate spec change.
- The `assertInvestigationCorpusFloor` function is the canonical gate
  for any consumer that loads the corpus; tests that touch the
  corpus MUST call it before reading case counts.
- The case ids follow the `cog-feedback-NNN` convention. New
  adjudications in production get their own ids outside this corpus
  (the corpus is the calibration baseline, not the live dataset).
- Adjudication `label` values are restricted to the closed enum from
  PR #5 (`confirmed | incorrect | insufficient_data`). The
  `assertInvestigationCorpusFloor` function MUST reject any other
  value.

## Out of scope

- The eval nightly leg that consumes this corpus (lives in a separate
  package's CI job; this PR ships the calibration data, not the
  consumer).
- ConfirmedIncident promotion integration (out of scope for the
  calibration corpus itself).
