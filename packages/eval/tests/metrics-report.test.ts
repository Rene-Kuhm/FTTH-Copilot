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
 * RED proof: before `scripts/metrics-report.ts` exists, the named export
 * `generateMetricsReport` is `undefined` and every assertion below fails.
 * GREEN proof: after the stub ships, the output JSON is well-formed with
 * the documented keys + the literal `"TBD"` precision marker, and the
 * file lands at the expected on-disk path.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
