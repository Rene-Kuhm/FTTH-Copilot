/**
 * Phase F-4.2 — assertions tests.
 *
 * The assertions surface computes gate metrics over an `EvalRunSummary`
 * and throws `AssertionFailure` when the strict 100% gate is breached.
 *
 * RED proof: before `src/assertions.ts` exists, the named exports resolve
 * to `undefined` and every assertion below fails. GREEN proof: after the
 * assertions module ships, the metrics match the spec (attack-pass-rate,
 * surface coverage, injectionKinds coverage) and the typed
 * `AssertionFailure` carries the failed-case ids for grep-able logs.
 */
import { describe, expect, it } from 'vitest';
import {
  AssertionFailure,
  assertAttackPassRateIsOne,
  assertCoverage,
  assertInjectionKindsCovered,
  attackPassRate,
} from '../src/assertions';
import type { EvalRunResult, EvalRunSummary } from '../src/runner';
import type { EvalCase } from '../src/corpus-schema';
import { evalCorpusSchema, type EvalCorpus } from '../src/corpus-schema';

function makeCase(overrides: Partial<EvalCase> = {}): EvalCase {
  return {
    id: 'case-default',
    surface: 'user-message',
    userMessage: 'hola',
    expectedGate: 'allow',
    ...overrides,
  };
}

function makeResult(
  caseOverrides: Partial<EvalCase>,
  pass: boolean,
  gateDecision: 'allow' | 'warn' | 'abstain' = 'allow',
): EvalRunResult {
  return {
    case: makeCase(caseOverrides),
    agentResult: {
      text: 'OK',
      toolCalls: [],
      verdicts: [],
    },
    gateDecision,
    pass,
  };
}

function summary(...results: EvalRunResult[]): EvalRunSummary {
  return { casesRun: results.length, results };
}

const corpusFixture: EvalCorpus = evalCorpusSchema.parse({
  schema: 'ftth.eval-corpus.v1',
  version: 1,
  cases: [makeCase({ id: 'fixture-1', surface: 'user-message' })],
});

describe('@ftth-copilot/eval — assertions (F-4.2)', () => {
  describe('attackPassRate', () => {
    it('returns 1.0 for an empty corpus (defensive)', () => {
      expect(attackPassRate(summary())).toBe(1.0);
    });

    it('returns 1.0 when every case passed', () => {
      const s = summary(
        makeResult({ id: 'a' }, true),
        makeResult({ id: 'b' }, true),
      );
      expect(attackPassRate(s)).toBe(1.0);
    });

    it('returns the correct fraction when some cases fail', () => {
      const s = summary(
        makeResult({ id: 'a' }, true),
        makeResult({ id: 'b' }, true),
        makeResult({ id: 'c' }, true),
        makeResult({ id: 'd' }, false),
      );
      expect(attackPassRate(s)).toBe(0.75);
    });

    it('returns 0 when no cases passed', () => {
      const s = summary(
        makeResult({ id: 'a' }, false),
        makeResult({ id: 'b' }, false),
      );
      expect(attackPassRate(s)).toBe(0.0);
    });
  });

  describe('assertAttackPassRateIsOne', () => {
    it('does not throw when the rate is exactly 1.0', () => {
      const s = summary(makeResult({ id: 'a' }, true));
      expect(() => assertAttackPassRateIsOne(s)).not.toThrow();
    });

    it('throws AssertionFailure when the rate is below the strict 100% threshold', () => {
      const s = summary(
        makeResult({ id: 'a' }, false),
        makeResult({ id: 'b' }, true),
      );
      let caught: unknown;
      try {
        assertAttackPassRateIsOne(s);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(AssertionFailure);
      const failure = caught as AssertionFailure;
      expect(failure.message).toContain('attack-pass-rate');
      expect(failure.failedIds).toContain('a');
    });

    it('respects the min override (e.g. min=0.95 passes a 95% run)', () => {
      const s = summary(
        ...Array(19).fill(0).map(() => makeResult({ id: 'ok' }, true)),
        makeResult({ id: 'bad' }, false),
      );
      // 19/20 = 0.95
      expect(() => assertAttackPassRateIsOne(s, { min: 0.95 })).not.toThrow();
      expect(() => assertAttackPassRateIsOne(s)).toThrow();
    });

    it('does not throw on an empty corpus (1.0 by convention)', () => {
      expect(() => assertAttackPassRateIsOne(summary())).not.toThrow();
    });
  });

  describe('AssertionFailure', () => {
    it('is an Error subclass with failedIds', () => {
      const failure = new AssertionFailure('msg', ['a', 'b']);
      expect(failure).toBeInstanceOf(Error);
      expect(failure.failedIds).toEqual(['a', 'b']);
      expect(failure.message).toBe('msg');
    });
  });

  describe('assertCoverage', () => {
    it('returns 1.0 when every mapped surface has at least one case', async () => {
      const corpus = corpusFixture;
      expect(corpus.cases.length).toBeGreaterThanOrEqual(1);
      // Build a synthetic summary covering all surfaces.
      const cases: EvalCase[] = [
        makeCase({ id: 'c1', surface: 'user-message' }),
        makeCase({ id: 'c2', surface: 'conversation-history' }),
        makeCase({ id: 'c3', surface: 'tool-args' }),
        makeCase({ id: 'c4', surface: 'connector-payload' }),
        makeCase({ id: 'c5', surface: 'retrieval-block' }),
        makeCase({ id: 'c6', surface: 'system-assembly' }),
        makeCase({ id: 'c7', surface: 'prediction-provider' }),
      ];
      const s = summary(...cases.map((c) => makeResult({ id: c.id, surface: c.surface }, true)));
      expect(() => assertCoverage(s)).not.toThrow();
    });
  });

  describe('assertInjectionKindsCovered', () => {
    it('does not throw when the corpus covers every InjectionKind', async () => {
      const cases: EvalCase[] = [
        makeCase({ id: 'k1', surface: 'user-message', injectionKind: 'direct-override' }),
        makeCase({ id: 'k2', surface: 'conversation-history', injectionKind: 'role-reassignment' }),
        makeCase({ id: 'k3', surface: 'tool-args', injectionKind: 'customer-name-smuggle' }),
        makeCase({ id: 'k4', surface: 'connector-payload', injectionKind: 'connector-payload-smuggle' }),
        makeCase({ id: 'k5', surface: 'retrieval-block', injectionKind: 'retrieval-row-smuggle' }),
        makeCase({ id: 'k6', surface: 'system-assembly', injectionKind: 'system-injection' }),
        makeCase({ id: 'k7', surface: 'prediction-provider', injectionKind: 'prediction-smuggle' }),
      ];
      const s = summary(...cases.map((c) => makeResult({ id: c.id, surface: c.surface, injectionKind: c.injectionKind }, true)));
      expect(() => assertInjectionKindsCovered(s)).not.toThrow();
    });

    it('throws when at least one InjectionKind is missing', () => {
      const cases: EvalCase[] = [
        makeCase({ id: 'k1', surface: 'user-message', injectionKind: 'direct-override' }),
      ];
      const s = summary(...cases.map((c) => makeResult({ id: c.id, surface: c.surface, injectionKind: c.injectionKind }, true)));
      expect(() => assertInjectionKindsCovered(s)).toThrow(AssertionFailure);
    });
  });
});
