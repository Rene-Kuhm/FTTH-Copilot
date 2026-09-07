# NOC labels runbook (P1.1)

Quick-start for the NOC tech lead who owns `docs/validation/labels.csv`.
This file lives in `docs/validation/` next to the CSV; both files are
edited by hand.

## Why this file exists

The nightly metrics report (`packages/eval/scripts/metrics-report.ts`,
schema `ftth.eval-metrics.v1`) reads this CSV to compute `precision`.
As long as the CSV has only the header row, the JSON artifact
(`metrics-summary.json`) reports `precision: "TBD"` (per Fase F
decision #6, see `packages/eval/src/metrics.ts`). Once you add
labelled rows, the report stops emitting `TBD` and emits a real
number. The goal of P1.1 is **no `TBD` in nightly reports**.

## File format (authoritative)

`docs/validation/labels.csv` is a minimal CSV. No quoting, no
escapes, no commas inside cells. Fixed header:

```csv
case_id,factual_claim_supported,ground_truth_severity,labeled_by,labeled_at
```

Columns:

| Column | Type | Allowed values |
|--------|------|-----------------|
| `case_id` | non-empty string | the `id` field of an entry in `corpus/pink.json` or `corpus/red.json` (e.g. `pink-user-message-001`, `red-tool-args-001`) |
| `factual_claim_supported` | boolean | `true` or `false` (lowercase only) |
| `ground_truth_severity` | enum | `critical`, `major`, `minor`, `none` |
| `labeled_by` | non-empty string | your handle (e.g. `jperez`) |
| `labeled_at` | ISO-8601 datetime, UTC preferred | e.g. `2026-09-08T13:45:00.000Z` |

The header row is mandatory and column order is fixed. The parser
(`packages/eval/src/labels-schema.ts`) is `z.object(...).strict()` —
any deviation (extra column, missing column, reordered, malformed
datetime) raises a `LabelsParseError` naming the offending row and
column.

### About `case_id`

Use only the IDs that appear in `packages/eval/corpus/{pink,red}.json`
(`id` field, e.g. `pink-user-message-001`, `pink-conversation-history-001`,
`red-injection-user-message-001`). The corpus is the v1 source of
truth; row matching in the metrics report runs against the same IDs.

Do not use `Q1`, `Q2`, etc. — those are question IDs from
`docs/validation/agent-qa-log.md` (a separate, pre-Fase-F manual QA
suite). They are not loadable by the CSV parser.

## How to label a row

For each `case_id` from a recent nightly run that scored `TBD`
on `precision`:

1. Open the latest run artifact `packages/eval/reports/metrics-summary.json`
   (uploaded by `.github/workflows/eval-nightly.yml`).
2. For each `case_id` flagged for label — typically the ones you can
   verify against your NOC records:
3. Decide:
   - **`factual_claim_supported`** — was the agent's factual claim
     correct against your records?
     - `true` — claim was supported.
     - `false` — claim was not supported.
   - **`ground_truth_severity`** — only meaningful when the answer
     was `false`. It tells downstream triage which class of failure
     to prioritise:
     - `critical` — wrong device identity, missed outage, or a fabricated
       fact the operator would act on.
     - `major` — wrong operational number (signal level, uptime, count).
     - `minor` — formatting/typo/wording that does not change the
       answer.
     - `none` — default when `factual_claim_supported` is `true`.
       (`critical`/`major`/`minor` are accepted by the parser when
       `true`, but are not used downstream in that case.)
4. Set `labeled_by` to your handle.
5. Set `labeled_at` to the current UTC time (ISO-8601; millisecond
   precision is safest).
6. Append the row to `docs/validation/labels.csv`. Order does not
   matter; rows are matched to corpus cases by `case_id`.

### Worked example

Suppose the nightly report row for `pink-user-message-007` shows
the agent's claim was "OLT-001-test is up". You verify OLT-001-test
was actually up at that timestamp. Append:

```csv
case_id,factual_claim_supported,ground_truth_severity,labeled_by,labeled_at
pink-user-message-007,true,none,jperez,2026-09-08T14:02:31.000Z
```

If OLT-001-test was down at that timestamp:

```csv
case_id,factual_claim_supported,ground_truth_severity,labeled_by,labeled_at
pink-user-message-007,false,critical,jperez,2026-09-08T14:02:31.000Z
```

## Quick sanity before commit

Run this from the repo root before committing your CSV changes:

```bash
DOCS_VALIDATION_LABELS_PATH=docs/validation/labels.csv \
  pnpm --filter @ftth-copilot/eval run metrics-report
```

If the CSV is well-formed and has at least one data row, the script
prints `precision: 0.x` (a number) and writes
`packages/eval/reports/metrics-summary.json` with that value. If the
CSV is malformed, the script exits 0 (nightly never fails on shape)
but the `LabelsParseError` appears in stderr — fix the offending row
before committing.

The CLI flag `--labels` is an escape hatch — equivalent to the env
var, takes precedence, useful for local experimentation. Production
uses the env var wired by the nightly workflow.

## When you are unsure

- `factual_claim_supported` is the gate. If you cannot verify the
  claim against records you trust, do not label that case. Leave
  it out of the CSV; another operator can label it later.
- `ground_truth_severity` describes **why** the answer was wrong.
  When `factual_claim_supported` is `true`, the convention is `none`.
- Do not edit or remove `case_id`s already in the CSV. If you
  disagree with a previous label, add a new row and explain the
  disagreement in the PR description; dedup is a future task.

## Related files

- `packages/eval/src/labels-schema.ts` — wire contract and parser.
- `packages/eval/tests/labels-schema.test.ts` — coverage of the
  parser's accept/reject cases.
- `packages/eval/src/metrics.ts` — `computePrecision` and the
  `precision: 'TBD' | number` contract.
- `packages/eval/scripts/metrics-report.ts` — consumer; emits the
  nightly `metrics-summary.json` at `packages/eval/reports/`.
- `packages/eval/README.md` — package README with the shipped surface
  table; the row for `scripts/metrics-report.ts` now links here.
