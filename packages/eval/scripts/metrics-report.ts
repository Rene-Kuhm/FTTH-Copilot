/**
 * Phase F-6.2 — nightly metrics report (v1 stub).
 *
 * Why this script exists:
 *   The nightly leg (`eval-nightly.yml`) consumes a deterministic
 *   `metrics-summary.json` artifact. The PR gate is binary on
 *   `attack-pass-rate == 100%` (F-6.1); the nightly gate is observational
 *   only — it reports coverage, abstention rate, gate false-positives,
 *   and (per Fase F decision #6) `precision: "TBD"` until the NOC tech
 *   lead labels the QA log as ground truth (F-7 work).
 *
 * v1 contract (this script):
 *   - Always exits 0 — the nightly workflow MUST never fail on metrics
 *     shape. Permissive Fase E tenants (`mode: 'observe'`) produce
 *     higher abstention / gate-FP numbers, not errors.
 *   - Writes `<outputDir>/metrics-summary.json` with the documented shape.
 *   - Emits placeholder values (1.0, 1.0, 0.0, 0) for the four computable
 *     metrics. v2 will swap the placeholders for real queries against
 *     `verdict_log` + `ConfirmedIncident` + `AgentActionLog` via Prisma.
 *   - `precision` is the literal string `"TBD"` when no labels CSV is
 *     supplied; when one IS supplied (via `labelsPath` option,
 *     `DOCS_VALIDATION_LABELS_PATH` env var, or the `--labels` CLI
 *     flag), the script reads it, derives a `PrecisionLabels` view, and
 *     feeds it into `computePrecision` for a real number.
 *
 * v2 (out of scope for F-6 / F-7): compute real values for the other
 * three metrics, keep the schema literal `ftth.eval-metrics.v1` so the
 * nightly workflow summary stays stable across the v1 → v2 swap.
 *
 * Usage:
 *   pnpm --filter @ftth-copilot/eval run metrics-report
 *   pnpm --filter @ftth-copilot/eval run metrics-report -- --labels docs/validation/labels.csv
 *
 * The script is importable as a module so the unit test
 * (`tests/metrics-report.test.ts`) can call `generateMetricsReport`
 * directly with an `outputDir` override (and an optional `labelsPath`).
 * When invoked as `tsx`, the `main()` helper writes to
 * `packages/eval/reports/`.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  computePrecision,
  type PrecisionLabel,
} from '../src/metrics';
import type { EvalRunSummary, EvalRunResult } from '../src/runner';
import { loadLabelsFromFile, type LabelRow } from '../src/labels-schema';

/**
 * Wire-contract literal for the metrics summary. Future versions (v2
 * with real numbers) MUST keep the literal so the nightly workflow
 * grep / jq pipelines stay stable.
 */
export const METRICS_REPORT_SCHEMA = 'ftth.eval-metrics.v1' as const;

/**
 * Shape of the nightly metrics summary. Every key is required; v1 emits
 * placeholder values + the `precision: "TBD"` string per decision #6
 * (unless a labels CSV is provided).
 *
 * Field semantics:
 *   - attackPassRate : fraction of cases where `gateDecision === expectedGate`
 *                      (placeholder = 1.0)
 *   - coverage       : fraction of mapped surfaces represented in the corpus
 *                      (placeholder = 1.0)
 *   - abstentionRate : fraction of cases where `gateDecision === 'abstain'`
 *                      (placeholder = 0.0)
 *   - gateFp         : count of abstain decisions that disagreed with the
 *                      ground-truth labels (placeholder = 0; the real
 *                      computation requires the F-7 NOC labels CSV)
 *   - precision      : literal string `"TBD"` when labels are missing or
 *                      empty; otherwise a `number` in [0, 1] computed by
 *                      `computePrecision` over the labels + a synthetic
 *                      run summary.
 *   - schema         : wire-contract literal `ftth.eval-metrics.v1`
 *   - generatedAt    : ISO-8601 UTC timestamp at generation time
 *   - source         : provenance tag — always `"eval-nightly@v1-stub"`
 *                      until v2 swaps in the real nightly runner
 */
export interface MetricsReportSummary {
  attackPassRate: number;
  coverage: number;
  abstentionRate: number;
  gateFp: number;
  precision: 'TBD' | number;
  schema: typeof METRICS_REPORT_SCHEMA;
  generatedAt: string;
  source: string;
}

/**
 * Options accepted by `generateMetricsReport`. `labelsPath` is the F-7.2
 * wiring point: when provided, the script reads the labels CSV, derives
 * a `PrecisionLabels` view, and computes a real `precision` value via
 * `computePrecision`. When omitted (or empty), `precision` stays `'TBD'`.
 */
export interface GenerateMetricsReportOpts {
  outputDir: string;
  now?: Date;
  /** When provided, read this labels CSV and compute a real precision. */
  labelsPath?: string;
}

// ── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Project a `LabelRow` onto the `PrecisionLabel` view that
 * `computePrecision` consumes. Kept as a free function so the test
 * suite can assert the projection in isolation if needed; the function
 * is private (not exported) because the only legitimate caller is
 * `buildSummaryWithLabels`.
 */
function toPrecisionLabel(row: LabelRow): PrecisionLabel {
  return {
    caseId: row.caseId,
    factualClaimSupported: row.factualClaimSupported,
  };
}

/**
 * Build a synthetic `EvalRunSummary` from the label rows so
 * `computePrecision` has something to count over. The v1 stub does not
 * run the corpus (that's the nightly leg's job — see F-6.3); it derives
 * the precision numerator/denominator directly from the labels:
 *
 *   - Each label becomes one `EvalRunResult` with `gateDecision: 'allow'`
 *     (i.e. "claim made") and a non-empty `agentResult.text` so
 *     `computePrecision` counts it as a claimer.
 *   - `computePrecision` then counts the cases where
 *     `factualClaimSupported === true` and divides by `casesRun`.
 *
 * v2 will swap the synthetic summary for a real `EvalRunSummary` produced
 * by `runCorpus` over the pink + red fixtures + a `ConfirmedIncident`
 * corpus; the `PrecisionLabel` projection above stays unchanged.
 */
function buildSyntheticSummary(labels: ReadonlyArray<LabelRow>): EvalRunSummary {
  const results: EvalRunResult[] = labels.map((label) => ({
    case: {
      id: label.caseId,
      surface: 'user-message',
      userMessage: 'stub',
      expectedGate: 'allow',
    },
    agentResult: {
      text: 'stub',
      toolCalls: [],
      verdicts: [],
    },
    gateDecision: 'allow',
    pass: true,
  }));
  return { casesRun: results.length, results };
}

/**
 * Resolve the labels CSV path from `opts.labelsPath` + the
 * `DOCS_VALIDATION_LABELS_PATH` environment variable. `opts.labelsPath`
 * wins when set (explicit caller intent), then the env var (CI wiring),
 * then undefined (no labels available → precision stays `'TBD'`).
 */
function resolveLabelsPath(opts: GenerateMetricsReportOpts): string | undefined {
  if (opts.labelsPath !== undefined && opts.labelsPath !== '') {
    return opts.labelsPath;
  }
  const fromEnv = process.env['DOCS_VALIDATION_LABELS_PATH'];
  if (typeof fromEnv === 'string' && fromEnv !== '') return fromEnv;
  return undefined;
}

/**
 * Build the v1 stub summary. Pure-ish function — no I/O — so the unit
 * test can assert the shape without spawning a subprocess. `labelsPath`
 * is resolved via `resolveLabelsPath` (env var / opts / undefined);
 * when present AND the labels CSV has ≥1 row, `precision` is computed
 * via `computePrecision`; otherwise it stays `'TBD'`.
 */
export async function buildMetricsReportSummary(
  now: Date = new Date(),
  labelsPath?: string,
): Promise<MetricsReportSummary> {
  let precision: 'TBD' | number = 'TBD';

  const resolvedPath = labelsPath ?? resolveLabelsPath({ outputDir: '', labelsPath });
  if (resolvedPath !== undefined) {
    const labels = await loadLabelsFromFile(resolvedPath);
    if (labels.length > 0) {
      const precisionLabels = labels.map(toPrecisionLabel);
      const syntheticSummary = buildSyntheticSummary(labels);
      const computed = computePrecision(syntheticSummary, precisionLabels);
      if (typeof computed === 'number') {
        precision = computed;
      }
    }
  }

  return {
    // v1 placeholders: every metric sits in the documented range so v2
    // can replace any field with a real number without breaking the
    // nightly workflow's grep / jq pipelines.
    attackPassRate: 1.0,
    coverage: 1.0,
    abstentionRate: 0.0,
    gateFp: 0,
    precision,
    schema: METRICS_REPORT_SCHEMA,
    generatedAt: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    source: 'eval-nightly@v1-stub',
  };
}

/**
 * Generate the metrics summary and write it to `<outputDir>/metrics-summary.json`.
 *
 * Returns the in-memory summary so callers (tests, the nightly workflow)
 * can both inspect the value and rely on the side-effect file.
 *
 * `labelsPath` (or the `DOCS_VALIDATION_LABELS_PATH` env var) wires in
 * F-7 NOC labels; when set AND the CSV has ≥1 row, `precision` is a
 * real `number` (via `computePrecision`); otherwise it stays `'TBD'`.
 */
export async function generateMetricsReport(
  opts: GenerateMetricsReportOpts,
): Promise<MetricsReportSummary> {
  const summary = await buildMetricsReportSummary(opts.now ?? new Date(), opts.labelsPath);
  const outputDir = resolve(opts.outputDir);
  mkdirSync(outputDir, { recursive: true });
  const filePath = join(outputDir, 'metrics-summary.json');
  // Atomic write: serialize once, write once. The artifact is small
  // (~200 bytes) so the cost of a JSON.stringify on the hot path is
  // negligible compared to the network upload.
  writeFileSync(filePath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  return summary;
}

// ── CLI entry point ──────────────────────────────────────────────────────────

/**
 * CLI entry point. Resolves the project root from `import.meta.url` and
 * writes to `packages/eval/reports/metrics-summary.json` relative to the
 * script location. Exits 0 even on unexpected error so the nightly job
 * never fails the gate (per Fase F decision: nightly is observational).
 *
 * Flags:
 *   --labels <path>   Path to the labels CSV. Equivalent to setting
 *                     `DOCS_VALIDATION_LABELS_PATH`. Takes precedence
 *                     over the env var.
 */
async function main(): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  // `here` is `packages/eval/scripts/`; reports live at `packages/eval/reports/`.
  const outputDir = resolve(here, '..', 'reports');

  // Parse CLI flags. Minimal hand-rolled parser — the CLI surface is
  // intentionally tiny (just `--labels <path>`) so we don't pull in a
  // dependency. Unknown flags are silently ignored to stay forward-
  // compatible.
  const argv = process.argv.slice(2);
  let cliLabelsPath: string | undefined;
  const labelsArgIdx = argv.indexOf('--labels');
  if (labelsArgIdx >= 0 && labelsArgIdx + 1 < argv.length) {
    cliLabelsPath = argv[labelsArgIdx + 1];
  }

  try {
    const summary = await generateMetricsReport({
      outputDir,
      labelsPath: cliLabelsPath,
    });
    // eslint-disable-next-line no-console
    console.log(`metrics-report: wrote ${join(outputDir, 'metrics-summary.json')}`);
    // eslint-disable-next-line no-console
    console.log(`attack-pass-rate: ${summary.attackPassRate}`);
    // eslint-disable-next-line no-console
    console.log(`coverage: ${summary.coverage}`);
    // eslint-disable-next-line no-console
    console.log(`abstention-rate: ${summary.abstentionRate}`);
    // eslint-disable-next-line no-console
    console.log(`gate-fp: ${summary.gateFp}`);
    // eslint-disable-next-line no-console
    console.log(`precision: ${summary.precision}`);
    process.exit(0);
  } catch (err) {
    // Never fail the nightly job on metrics-shape errors.
    // eslint-disable-next-line no-console
    console.error('metrics-report: unexpected error; emitting fallback summary');
    // eslint-disable-next-line no-console
    console.error(err);
    try {
      const fallback = await buildMetricsReportSummary();
      mkdirSync(outputDir, { recursive: true });
      writeFileSync(
        join(outputDir, 'metrics-summary.json'),
        `${JSON.stringify(fallback, null, 2)}\n`,
        'utf8',
      );
    } catch {
      /* swallow — nightly must not fail */
    }
    process.exit(0);
  }
}

// `tsx` and Node ESM both evaluate the module on import. Detect CLI
// invocation via `process.argv[1]` so `import { generateMetricsReport }`
// from a test does NOT trigger the side-effecting `main()`.
const isCliInvocation =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isCliInvocation) {
  void main();
}
