/**
 * Phase F-4.3 — metrics tests.
 *
 * The metrics layer computes nightly aggregate values over an
 * `EvalRunSummary` (and the corpus itself, for coverage). The four
 * primitives:
 *
 *   - `computeCoverage` — fraction of mapped surfaces represented in the
 *     corpus (0..1).
 *   - `computePrecision` — `null` while NOC labels are missing
 *     (decision #6); future v2 will accept `PrecisionLabels` and compute
 *     over them.
 *   - `computeAbstentionRate` — fraction of cases where `gateDecision ===
 *     'abstain'`.
 *   - `computeGateFalsePositives` — count of `gateDecision === 'abstain'`
 *     cases whose `caseId` is NOT in the `expectedSupportsAbstain` set;
 *     v1 returns 0 when the set is empty (no false-positive signal
 *     without ground truth).
 *
 * RED proof: before `src/metrics.ts` exists, the named exports resolve
 * to `undefined` and every assertion below fails. GREEN proof: after
 * the metrics module ships, the typed surface round-trips the spec.
 */
import { describe, expect, it } from 'vitest';
import type { EvalCorpus } from '../src/corpus-schema';
import { evalCorpusSchema } from '../src/corpus-schema';
import { loadPinkCorpus } from '../src/corpus-loader';
import type { EvalRunResult, EvalRunSummary } from '../src/runner';
import {
  computeAbstentionRate,
  computeCoverage,
  computeGateFalsePositives,
  computePrecision,
  type PrecisionLabels,
} from '../src/metrics';

function makeCase(overrides: Partial<{ id: string; surface: 'user-message' | 'conversation-history' | 'tool-args' | 'connector-payload' | 'retrieval-block' | 'system-assembly' | 'prediction-provider'; expectedGate: 'allow' | 'warn' | 'abstain'; injectionKind?: string }> = {}): EvalCorpus['cases'][number] {
  return {
    id: overrides.id ?? 'case-default',
    surface: overrides.surface ?? 'user-message',
    userMessage: 'hola',
    expectedGate: overrides.expectedGate ?? 'allow',
    ...(overrides.injectionKind !== undefined ? { injectionKind: overrides.injectionKind as EvalCorpus['cases'][number]['injectionKind'] } : {}),
  };
}

function makeResult(
  caseOverrides: Parameters<typeof makeCase>[0],
  pass: boolean,
  gateDecision: 'allow' | 'warn' | 'abstain' = 'allow',
): EvalRunResult {
  return {
    case: makeCase(caseOverrides),
    agentResult: { text: 'OK', toolCalls: [], verdicts: [] },
    gateDecision,
    pass,
  };
}

function summary(...results: EvalRunResult[]): EvalRunSummary {
  return { casesRun: results.length, results };
}

describe('@ftth-copilot/eval — metrics (F-4.3)', () => {
  describe('computeCoverage', () => {
    it('returns 1.0 when every mapped surface has at least one case', () => {
      // Build a corpus with all 7 surfaces present.
      const corpus: EvalCorpus = evalCorpusSchema.parse({
        schema: 'ftth.eval-corpus.v1',
        version: 1,
        cases: [
          makeCase({ id: 'c1', surface: 'user-message' }),
          makeCase({ id: 'c2', surface: 'conversation-history' }),
          makeCase({ id: 'c3', surface: 'tool-args' }),
          makeCase({ id: 'c4', surface: 'connector-payload' }),
          makeCase({ id: 'c5', surface: 'retrieval-block' }),
          makeCase({ id: 'c6', surface: 'system-assembly' }),
          makeCase({ id: 'c7', surface: 'prediction-provider' }),
        ],
      });
      expect(computeCoverage(corpus)).toBe(1.0);
    });

    it('returns 1.0 for the committable pink corpus', () => {
      expect(computeCoverage(loadPinkCorpus())).toBe(1.0);
    });

    it('returns 5/7 ≈ 0.714 when two surfaces are missing', () => {
      const corpus: EvalCorpus = evalCorpusSchema.parse({
        schema: 'ftth.eval-corpus.v1',
        version: 1,
        cases: [
          makeCase({ id: 'c1', surface: 'user-message' }),
          makeCase({ id: 'c2', surface: 'conversation-history' }),
          makeCase({ id: 'c3', surface: 'tool-args' }),
          makeCase({ id: 'c4', surface: 'connector-payload' }),
          makeCase({ id: 'c5', surface: 'retrieval-block' }),
          // Missing: system-assembly, prediction-provider
        ],
      });
      const coverage = computeCoverage(corpus);
      expect(coverage).toBeCloseTo(5 / 7, 5);
      expect(coverage).toBeLessThan(1.0);
    });

    it('returns 1/7 for a single-case corpus (one surface covered, six missing)', () => {
      // The schema enforces `cases.length >= 1`, so a literal empty
      // corpus is blocked at validation. The closest equivalent is a
      // single-case corpus that covers exactly one surface; coverage
      // is then 1/7.
      const corpus: EvalCorpus = evalCorpusSchema.parse({
        schema: 'ftth.eval-corpus.v1',
        version: 1,
        cases: [makeCase({ id: 'only', surface: 'user-message' })],
      });
      expect(computeCoverage(corpus)).toBe(1 / 7);
    });
  });

  describe('computePrecision', () => {
    it('returns null when labels is null (TBD marker — Fase F v1 default)', () => {
      const s = summary(
        makeResult({ id: 'a' }, true),
        makeResult({ id: 'b' }, true),
      );
      expect(computePrecision(s, null)).toBeNull();
    });

    it('accepts an empty labels array (TBD marker — still null per decision #6)', () => {
      const s = summary(makeResult({ id: 'a' }, true));
      expect(computePrecision(s, [])).toBeNull();
    });

    it('returns 1.0 when labels mark every case factualClaimSupported=true', () => {
      const s = summary(
        makeResult({ id: 'a' }, true),
        makeResult({ id: 'b' }, true),
      );
      const labels: PrecisionLabels = [
        { caseId: 'a', factualClaimSupported: true },
        { caseId: 'b', factualClaimSupported: true },
      ];
      expect(computePrecision(s, labels)).toBe(1.0);
    });

    it('returns the correct ratio when labels are partial', () => {
      const s = summary(
        makeResult({ id: 'a' }, true),
        makeResult({ id: 'b' }, true),
        makeResult({ id: 'c' }, true),
        makeResult({ id: 'd' }, true),
      );
      const labels: PrecisionLabels = [
        { caseId: 'a', factualClaimSupported: true },
        { caseId: 'b', factualClaimSupported: true },
        { caseId: 'c', factualClaimSupported: false },
        { caseId: 'd', factualClaimSupported: false },
      ];
      expect(computePrecision(s, labels)).toBe(0.5);
    });
  });

  describe('computeAbstentionRate', () => {
    it('returns 0.25 for 1 abstain + 3 allow', () => {
      const s = summary(
        makeResult({ id: 'a' }, true, 'allow'),
        makeResult({ id: 'b' }, true, 'allow'),
        makeResult({ id: 'c' }, true, 'allow'),
        makeResult({ id: 'd' }, true, 'abstain'),
      );
      expect(computeAbstentionRate(s)).toBe(0.25);
    });

    it('returns 0.0 for an empty summary', () => {
      expect(computeAbstentionRate(summary())).toBe(0.0);
    });

    it('returns 1.0 when every case abstained', () => {
      const s = summary(
        makeResult({ id: 'a' }, true, 'abstain'),
        makeResult({ id: 'b' }, true, 'abstain'),
      );
      expect(computeAbstentionRate(s)).toBe(1.0);
    });
  });

  describe('computeGateFalsePositives', () => {
    it('returns 0 when expectedSupportsAbstain is empty (no ground truth)', () => {
      const s = summary(
        makeResult({ id: 'a' }, true, 'abstain'),
        makeResult({ id: 'b' }, true, 'abstain'),
      );
      expect(computeGateFalsePositives(s, new Set())).toBe(0);
    });

    it('counts cases where gateDecision=abstain but caseId not in expectedSupportsAbstain', () => {
      const s = summary(
        makeResult({ id: 'a' }, true, 'abstain'),
        makeResult({ id: 'b' }, true, 'abstain'),
        makeResult({ id: 'c' }, true, 'abstain'),
        makeResult({ id: 'd' }, true, 'allow'),
      );
      const expectedSupportsAbstain = new Set(['a']);
      // abstains: a, b, c. Of these, only 'a' is expected → FPs = b, c → 2.
      expect(computeGateFalsePositives(s, expectedSupportsAbstain)).toBe(2);
    });

    it('returns 0 when every abstaining case is in expectedSupportsAbstain', () => {
      const s = summary(
        makeResult({ id: 'a' }, true, 'abstain'),
        makeResult({ id: 'b' }, true, 'abstain'),
      );
      expect(computeGateFalsePositives(s, new Set(['a', 'b']))).toBe(0);
    });
  });
});
