import { describe, expect, it } from 'vitest';
import {
  assertInvestigationCorpusFloor,
  INVESTIGATION_CORPUS,
  INVESTIGATION_CORPUS_SCHEMA,
  INVESTIGATION_CORPUS_VERSION,
  loadInvestigationCorpus,
} from './fixtures/investigation-corpus';
import {
  computeFeedbackSummary,
  FEEDBACK_LABEL_CONFIRMED,
  FEEDBACK_LABEL_INCORRECT,
  toInvestigationFeedbackExport,
  type InvestigationFeedbackExportEntry,
} from '../src/feedback-export';

describe('Investigation corpus — fixture integrity', () => {
  it('exposes the locked schema and version', () => {
    expect(INVESTIGATION_CORPUS_SCHEMA).toBe('ftth.investigation-corpus.v1');
    expect(INVESTIGATION_CORPUS_VERSION).toBe(1);
    expect(INVESTIGATION_CORPUS.schema).toBe(INVESTIGATION_CORPUS_SCHEMA);
    expect(INVESTIGATION_CORPUS.version).toBe(INVESTIGATION_CORPUS_VERSION);
  });

  it('passes the spec floor (>=30 cases, >=5 per label)', () => {
    expect(() => assertInvestigationCorpusFloor()).not.toThrow();
  });

  it('contains exactly 35 cases (25 confirmed + 5 incorrect + 5 insufficient)', () => {
    expect(INVESTIGATION_CORPUS.cases).toHaveLength(35);
    const counts: Record<typeof INVESTIGATION_CORPUS.cases[number]['label'], number> = {
      confirmed: 0,
      incorrect: 0,
      insufficient_data: 0,
    };
    for (const c of INVESTIGATION_CORPUS.cases) {
      counts[c.label] += 1;
    }
    expect(counts).toEqual({ confirmed: 25, incorrect: 5, insufficient_data: 5 });
  });

  it('every caseId is unique', () => {
    const ids = new Set<string>();
    for (const c of INVESTIGATION_CORPUS.cases) {
      ids.add(c.caseId);
    }
    expect(ids.size).toBe(INVESTIGATION_CORPUS.cases.length);
  });

  it('every caseId follows the cog-feedback-NNN convention', () => {
    for (const c of INVESTIGATION_CORPUS.cases) {
      expect(c.caseId).toMatch(/^cog-feedback-\d{3}$/);
    }
  });

  it('every adjudicatedAt is a valid ISO datetime', () => {
    for (const c of INVESTIGATION_CORPUS.cases) {
      expect(() => new Date(c.adjudicatedAt).toISOString()).not.toThrow();
      // Round-trip is the canonical Zod iso-datetime check.
      expect(new Date(c.adjudicatedAt).toISOString()).toBe(c.adjudicatedAt);
    }
  });

  it('loadInvestigationCorpus returns a defensive copy (mutations do not leak)', () => {
    // The corpus type is Readonly; the loader returns a mutable copy
    // so tests / consumers can stage data without polluting the
    // frozen source.
    const a = loadInvestigationCorpus();
    a.cases[0]!.label = FEEDBACK_LABEL_INCORRECT;
    a.cases[0]!.notes = 'tampered';
    const b = loadInvestigationCorpus();
    expect(b.cases[0]!.label).toBe(FEEDBACK_LABEL_CONFIRMED);
    expect(b.cases[0]!.notes).not.toBe('tampered');
  });

  it('the exported corpus type is Readonly (cannot be mutated through the const)', () => {
    // Type-level guard: `INVESTIGATION_CORPUS.cases[0].label = ...` does
    // not compile. We assert the type with a phantom assignment.
    type AssertReadonly<T> = T extends ReadonlyArray<unknown> ? true : false;
    const check: AssertReadonly<typeof INVESTIGATION_CORPUS.cases> = true;
    expect(check).toBe(true);
  });
});

describe('Investigation corpus — precision contract integration', () => {
  it('feeding the corpus into computeFeedbackSummary meets the threshold', () => {
    // Convert the corpus to InvestigationFeedbackExportEntry (the
    // shape the eval nightly leg consumes). The fixture has
    // 25 confirmed + 5 incorrect = 30 evaluated, exactly the
    // DEFAULT_MIN_SAMPLE_SIZE. precision MUST be calibrated.
    const entries: InvestigationFeedbackExportEntry[] = INVESTIGATION_CORPUS.cases.map(
      (c) =>
        toInvestigationFeedbackExport({
          tenantId: 'corpus-tenant',
          feedbackId: `corpus-${c.caseId}`,
          runId: 'r_corpus',
          versionId: 'v_corpus',
          label: c.label,
          authorUserId: c.adjudicatedBy,
          submittedAt: c.adjudicatedAt,
        }),
    );
    const summary = computeFeedbackSummary(entries);
    expect(summary.total).toBe(35);
    expect(summary.confirmed).toBe(25);
    expect(summary.incorrect).toBe(5);
    expect(summary.insufficient_data).toBe(5);
    expect(summary.evaluated).toBe(30);
    expect(summary.isCalibrated).toBe(true);
    expect(summary.precision).toBeCloseTo(25 / 30, 10);
  });

  it('drops a confirmed case below threshold → precision=null', () => {
    const entries: InvestigationFeedbackExportEntry[] = INVESTIGATION_CORPUS.cases
      .filter((c) => c.label !== FEEDBACK_LABEL_CONFIRMED || c.caseId.endsWith('001'))
      .map((c) =>
        toInvestigationFeedbackExport({
          tenantId: 'corpus-tenant',
          feedbackId: `corpus-${c.caseId}`,
          runId: 'r_corpus',
          versionId: 'v_corpus',
          label: c.label,
          authorUserId: c.adjudicatedBy,
          submittedAt: c.adjudicatedAt,
        }),
      );
    // 1 confirmed + 5 incorrect + 5 insufficient_data = 6 evaluated
    // → below DEFAULT_MIN_SAMPLE_SIZE (30). precision MUST be null.
    const summary = computeFeedbackSummary(entries);
    expect(summary.isCalibrated).toBe(false);
    expect(summary.precision).toBeNull();
  });
});

describe('assertInvestigationCorpusFloor — explicit violations', () => {
  it('throws when total < 30', () => {
    const tiny = { ...INVESTIGATION_CORPUS, cases: INVESTIGATION_CORPUS.cases.slice(0, 5) };
    expect(() => assertInvestigationCorpusFloor(tiny)).toThrow(/30/);
  });

  it('throws when a label is missing the floor', () => {
    const reduced: typeof INVESTIGATION_CORPUS = {
      ...INVESTIGATION_CORPUS,
      cases: INVESTIGATION_CORPUS.cases.map((c) =>
        c.label === FEEDBACK_LABEL_CONFIRMED
          ? { ...c, label: 'insufficient_data' as const }
          : c,
      ),
    };
    // Now 0 confirmed, 25 insufficient_data — confirmed floor fails.
    expect(() => assertInvestigationCorpusFloor(reduced)).toThrow(/confirmed/);
  });

  it('throws on a duplicate caseId', () => {
    const dup: Readonly<typeof INVESTIGATION_CORPUS> = {
      ...INVESTIGATION_CORPUS,
      cases: [
        INVESTIGATION_CORPUS.cases[0]!,
        ...INVESTIGATION_CORPUS.cases.slice(1),
        { ...INVESTIGATION_CORPUS.cases[0]! }, // duplicate
      ] as ReadonlyArray<typeof INVESTIGATION_CORPUS.cases[number]>,
    };
    expect(() => assertInvestigationCorpusFloor(dup)).toThrow(/duplicate caseId/);
  });

  it('throws on an unknown label', () => {
    const bad: Readonly<typeof INVESTIGATION_CORPUS> = {
      ...INVESTIGATION_CORPUS,
      cases: INVESTIGATION_CORPUS.cases.map((c, i) =>
        i === 0 ? { ...c, label: 'maintenance' as unknown as typeof c.label } : c,
      ),
    };
    expect(() => assertInvestigationCorpusFloor(bad)).toThrow(/invalid label/);
  });
});
