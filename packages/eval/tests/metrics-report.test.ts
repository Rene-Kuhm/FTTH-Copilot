/**
 * Phase F-6.2 — metrics-report stub (RED proof).
 *
 * The nightly leg needs a deterministic JSON report summarizing coverage,
 * abstention rate, gate false-positives, and (per Fase F decision #6) a
 * `precision: "TBD"` marker until the NOC tech lead labels the QA log in
 * F-7. The script is a v1 stub: it always succeeds (exit 0), writes
 * `packages/eval/reports/metrics-summary.json`, and uses placeholder
 * values for the four computable metrics. The shape is the contract the
 * nightly job summary consumes; future v2 work will swap the placeholder
 * values for real computations over `verdict_log` + `ConfirmedIncident`.
 *
 * Phase F-7.2 — when a labels CSV is provided via the `labelsPath` option
 * (or `--labels` CLI flag / `DOCS_VALIDATION_LABELS_PATH` env var), the
 * stub reads it via `loadLabelsFromFile`, derives a `PrecisionLabels`
 * view, and calls `computePrecision` to produce a real number. Without
 * labels, `precision` stays the literal `'TBD'`.
 *
 * RED proof: before `scripts/metrics-report.ts` exists, the named export
 * `generateMetricsReport` is `undefined` and every assertion below fails.
 * GREEN proof: after the stub ships, the output JSON is well-formed with
 * the documented keys + the literal `"TBD"` precision marker, and the
 * file lands at the expected on-disk path.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  generateMetricsReport,
  type MetricsReportSummary,
} from '../scripts/metrics-report';

describe('@ftth-copilot/eval — metrics-report stub (F-6.2)', () => {
  it('exports a generateMetricsReport function', () => {
    expect(typeof generateMetricsReport).toBe('function');
  });

  it('writes a well-formed metrics-summary.json with the documented keys', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'eval-metrics-report-'));
    try {
      const summary: MetricsReportSummary = await generateMetricsReport({ outputDir: dir });

      // Returned shape must carry every nightly-summary key the workflow surfaces.
      expect(summary).toMatchObject({
        attackPassRate: expect.any(Number),
        coverage: expect.any(Number),
        abstentionRate: expect.any(Number),
        gateFp: expect.any(Number),
      });
      // Decision #6: precision is TBD until NOC labels exist (F-7).
      expect(summary.precision).toBe('TBD');

      // The on-disk artifact must exist and round-trip via JSON.parse.
      const path = join(dir, 'metrics-summary.json');
      const raw = readFileSync(path, 'utf8');
      const parsed: MetricsReportSummary = JSON.parse(raw);
      expect(parsed).toEqual(summary);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('uses placeholder values that satisfy the documented ranges', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'eval-metrics-report-'));
    try {
      const summary = await generateMetricsReport({ outputDir: dir });
      // v1 stub emits 1.0 / 1.0 / 0.0 / 0 placeholders — they MUST stay
      // in [0, 1] so future v2 code can replace them with real numbers
      // without breaking downstream consumers that assume fractions.
      expect(summary.attackPassRate).toBeGreaterThanOrEqual(0);
      expect(summary.attackPassRate).toBeLessThanOrEqual(1);
      expect(summary.coverage).toBeGreaterThanOrEqual(0);
      expect(summary.coverage).toBeLessThanOrEqual(1);
      expect(summary.abstentionRate).toBeGreaterThanOrEqual(0);
      expect(summary.abstentionRate).toBeLessThanOrEqual(1);
      expect(summary.gateFp).toBeGreaterThanOrEqual(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('embeds a stable schema version + generatedAt timestamp', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'eval-metrics-report-'));
    try {
      const summary = await generateMetricsReport({ outputDir: dir });
      expect(summary.schema).toBe('ftth.eval-metrics.v1');
      expect(summary.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('@ftth-copilot/eval — metrics-report precision wiring (F-7.2)', () => {
  const HEADER =
    'case_id,factual_claim_supported,ground_truth_severity,labeled_by,labeled_at';

  it('emits precision as a number when a labels CSV is provided (labelsPath)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'eval-metrics-report-'));
    try {
      const labelsPath = join(dir, 'labels.csv');
      // Fixture: 2 supported + 1 unsupported → precision = 2/3.
      writeFileSync(
        labelsPath,
        [
          HEADER,
          'Q1,true,minor,jperez,2026-08-20T10:00:00.000Z',
          'Q2,true,minor,jperez,2026-08-20T10:05:00.000Z',
          'Q3,false,major,jperez,2026-08-20T10:10:00.000Z',
        ].join('\n'),
      );
      const summary = await generateMetricsReport({ outputDir: dir, labelsPath });
      expect(typeof summary.precision).toBe('number');
      expect(summary.precision).toBeCloseTo(2 / 3, 5);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('emits precision as "TBD" when labelsPath is not provided', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'eval-metrics-report-'));
    try {
      const summary = await generateMetricsReport({ outputDir: dir });
      expect(summary.precision).toBe('TBD');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('emits precision as "TBD" when labelsPath points to a header-only CSV', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'eval-metrics-report-'));
    try {
      const labelsPath = join(dir, 'labels.csv');
      writeFileSync(labelsPath, `${HEADER}\n`);
      const summary = await generateMetricsReport({ outputDir: dir, labelsPath });
      expect(summary.precision).toBe('TBD');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes precision as a number in the on-disk JSON when labels exist', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'eval-metrics-report-'));
    try {
      const labelsPath = join(dir, 'labels.csv');
      writeFileSync(
        labelsPath,
        [
          HEADER,
          'Q1,true,minor,jperez,2026-08-20T10:00:00.000Z',
          'Q2,false,major,jperez,2026-08-20T10:05:00.000Z',
        ].join('\n'),
      );
      await generateMetricsReport({ outputDir: dir, labelsPath });
      const raw = readFileSync(join(dir, 'metrics-summary.json'), 'utf8');
      const parsed: MetricsReportSummary = JSON.parse(raw);
      expect(typeof parsed.precision).toBe('number');
      expect(parsed.precision).toBeCloseTo(0.5, 5);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
