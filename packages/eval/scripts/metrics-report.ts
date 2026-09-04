/**
 * Phase F-6.2 — nightly metrics report (v1 stub).
 *
 * Why this script exists:
 *   The nightly leg (`eval-nightly.yml`) consumes a deterministic
 *   `metrics-summary.json` artifact. The PR gate is binary on
 *   `attack-pass-rate == 100%` (F-6.1); the nightly gate is observational
 *   only — it reports coverage, abstention rate, gate false-positives,
 *   and (per Fase F decision #6) `precision: "TBD"` until the NOC tech
 *   lead labels `docs/validation/agent-qa-log.md` as ground truth
 *   (F-7 work).
 *
 * v1 contract (this script):
 *   - Always exits 0 — the nightly workflow MUST never fail on metrics
 *     shape. Permissive Fase E tenants (`mode: 'observe'`) produce
 *     higher abstention / gate-FP numbers, not errors.
 *   - Writes `<outputDir>/metrics-summary.json` with the documented shape.
 *   - Emits placeholder values (1.0, 1.0, 0.0, 0) for the four computable
 *     metrics. v2 will swap the placeholders for real queries against
 *     `verdict_log` + `ConfirmedIncident` + `AgentActionLog` via Prisma.
 *   - `precision: "TBD"` is the literal string per decision #6.
 *
 * v2 (out of scope for F-6): compute real values, accept the NOC labels
 * CSV as input, keep the schema literal `ftth.eval-metrics.v1` so the
 * nightly workflow summary stays stable across the v1 → v2 swap.
 *
 * Usage:
 *   pnpm --filter @ftth-copilot/eval run metrics-report
 *
 * The script is importable as a module so the unit test
 * (`tests/metrics-report.test.ts`) can call `generateMetricsReport`
 * directly with an `outputDir` override. When invoked as `tsx`, the
 * `main()` helper writes to `packages/eval/reports/`.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Wire-contract literal for the metrics summary. Future versions (v2
 * with real numbers) MUST keep the literal so the nightly workflow
 * grep / jq pipelines stay stable.
 */
export const METRICS_REPORT_SCHEMA = 'ftth.eval-metrics.v1' as const;

/**
 * Shape of the nightly metrics summary. Every key is required; v1 emits
 * placeholder values + the `precision: "TBD"` string per decision #6.
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
 *   - precision      : literal string `"TBD"` until F-7 labels exist
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
 * Build the v1 stub summary. Pure function — no I/O — so the unit test
 * can assert the shape without spawning a subprocess.
 */
export function buildMetricsReportSummary(now: Date = new Date()): MetricsReportSummary {
  return {
    // v1 placeholders: every metric sits in the documented range so v2
    // can replace any field with a real number without breaking the
    // nightly workflow's grep / jq pipelines.
    attackPassRate: 1.0,
    coverage: 1.0,
    abstentionRate: 0.0,
    gateFp: 0,
    precision: 'TBD',
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
 */
export async function generateMetricsReport(opts: {
  outputDir: string;
  now?: Date;
}): Promise<MetricsReportSummary> {
  const summary = buildMetricsReportSummary(opts.now ?? new Date());
  const outputDir = resolve(opts.outputDir);
  mkdirSync(outputDir, { recursive: true });
  const filePath = join(outputDir, 'metrics-summary.json');
  // Atomic write: serialize once, write once. The artifact is small
  // (~200 bytes) so the cost of a JSON.stringify on the hot path is
  // negligible compared to the network upload.
  writeFileSync(filePath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  return summary;
}

/**
 * CLI entry point. Resolves the project root from `import.meta.url` and
 * writes to `packages/eval/reports/metrics-summary.json` relative to the
 * script location. Exits 0 even on unexpected error so the nightly job
 * never fails the gate (per Fase F decision: nightly is observational).
 */
async function main(): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  // `here` is `packages/eval/scripts/`; reports live at `packages/eval/reports/`.
  const outputDir = resolve(here, '..', 'reports');
  try {
    const summary = await generateMetricsReport({ outputDir });
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
      const fallback = buildMetricsReportSummary();
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
