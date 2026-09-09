import { describe, expect, it } from 'vitest';
import {
  computeFeedbackSummary,
  DEFAULT_MIN_SAMPLE_SIZE,
  FEEDBACK_LABEL_CONFIRMED,
  FEEDBACK_LABEL_INCORRECT,
  FEEDBACK_LABEL_INSUFFICIENT,
  FEEDBACK_LABELS,
  FEEDBACK_TO_VERDICT_CODE,
  INVESTIGATION_FEEDBACK_EXPORT_SCHEMA,
  investigationFeedbackExportSchema,
  isFeedbackLabel,
  toInvestigationFeedbackExport,
  toInvestigationFeedbackExportBatch,
  type InvestigationFeedbackExportEntry,
} from '../src/feedback-export';

describe('feedback-export: enum', () => {
  it('exposes the three closed labels', () => {
    expect(FEEDBACK_LABELS).toEqual(['confirmed', 'incorrect', 'insufficient_data']);
  });

  it('isFeedbackLabel accepts only the three labels', () => {
    expect(isFeedbackLabel('confirmed')).toBe(true);
    expect(isFeedbackLabel('incorrect')).toBe(true);
    expect(isFeedbackLabel('insufficient_data')).toBe(true);
    expect(isFeedbackLabel('maintenance')).toBe(false);
    expect(isFeedbackLabel('')).toBe(false);
    expect(isFeedbackLabel(null)).toBe(false);
    expect(isFeedbackLabel(42)).toBe(false);
    expect(isFeedbackLabel({})).toBe(false);
  });

  it('the mapping table is exhaustive and locks the three VerdictCodes', () => {
    // Pin the table so a future spec change must touch this test, not
    // the schema. The mapping is documented in the spec delta.
    expect(FEEDBACK_TO_VERDICT_CODE).toEqual({
      confirmed: 'ok',
      incorrect: 'low_confidence',
      insufficient_data: 'incomplete',
    });
    for (const label of FEEDBACK_LABELS) {
      expect(['ok', 'low_confidence', 'incomplete']).toContain(
        FEEDBACK_TO_VERDICT_CODE[label],
      );
      expect(FEEDBACK_TO_VERDICT_CODE[label]).not.toBe('stale');
    }
  });
});

describe('feedback-export: envelope schema', () => {
  const baseRow = {
    tenantId: 'tenant-1',
    feedbackId: 'f_1',
    runId: 'r_1',
    versionId: 'v_1',
    authorUserId: 'u_1',
    submittedAt: new Date('2026-09-07T10:00:00.000Z'),
  };

  it('produces a strict envelope with the locked schema literal', () => {
    const out = toInvestigationFeedbackExport({
      ...baseRow,
      label: FEEDBACK_LABEL_CONFIRMED,
    });
    expect(out.schema).toBe(INVESTIGATION_FEEDBACK_EXPORT_SCHEMA);
    expect(out.schema).toBe('ftth.investigation-feedback-export.v1');
    expect(out.source).toBe('investigation-feedback');
    expect(out.mappedCode).toBe('ok');
    expect(out.observedAt).toBe('2026-09-07T10:00:00.000Z');
  });

  it('accepts a string submittedAt and normalizes it to ISO', () => {
    const out = toInvestigationFeedbackExport({
      ...baseRow,
      label: 'confirmed',
      submittedAt: '2026-09-07T10:00:00.000Z',
    });
    expect(out.observedAt).toBe('2026-09-07T10:00:00.000Z');
  });

  it('maps every label through the conversion table', () => {
    expect(
      toInvestigationFeedbackExport({ ...baseRow, label: 'confirmed' }).mappedCode,
    ).toBe('ok');
    expect(
      toInvestigationFeedbackExport({ ...baseRow, label: 'incorrect' }).mappedCode,
    ).toBe('low_confidence');
    expect(
      toInvestigationFeedbackExport({ ...baseRow, label: 'insufficient_data' }).mappedCode,
    ).toBe('incomplete');
  });

  it('rejects unknown fields (strict envelope)', () => {
    // The envelope is `.strict()`. A leaked internal column must NOT
    // silently widen the wire format.
    const out = toInvestigationFeedbackExport({
      ...baseRow,
      label: 'confirmed',
    });
    // Direct attempt: re-parse with a forged extra key.
    expect(() =>
      investigationFeedbackExportSchema.parse({ ...out, internalNote: 'leaked' }),
    ).toThrow();
  });

  it('rejects an unknown label (the closed enum does the guarding)', () => {
    expect(() =>
      toInvestigationFeedbackExport({
        ...baseRow,
        // Bypass the input typing deliberately.
        label: 'maintenance' as unknown as 'confirmed',
      }),
    ).toThrow();
  });

  it('preserves every input field into the envelope', () => {
    const out = toInvestigationFeedbackExport({
      ...baseRow,
      label: 'incorrect',
    });
    expect(out.feedbackId).toBe(baseRow.feedbackId);
    expect(out.tenantId).toBe(baseRow.tenantId);
    expect(out.runId).toBe(baseRow.runId);
    expect(out.versionId).toBe(baseRow.versionId);
    expect(out.authorUserId).toBe(baseRow.authorUserId);
    expect(out.label).toBe('incorrect');
  });
});

describe('feedback-export: batch', () => {
  it('preserves order (the eval nightly leg relies on it)', () => {
    const rows = [
      { tenantId: 't1', feedbackId: 'f_1', runId: 'r_1', versionId: 'v_1', authorUserId: 'u', label: 'confirmed' as const, submittedAt: '2026-09-07T10:00:00.000Z' },
      { tenantId: 't1', feedbackId: 'f_2', runId: 'r_1', versionId: 'v_1', authorUserId: 'u', label: 'incorrect' as const, submittedAt: '2026-09-07T10:01:00.000Z' },
      { tenantId: 't1', feedbackId: 'f_3', runId: 'r_1', versionId: 'v_1', authorUserId: 'u', label: 'insufficient_data' as const, submittedAt: '2026-09-07T10:02:00.000Z' },
    ];
    const batch = toInvestigationFeedbackExportBatch(rows);
    expect(batch.map((b: InvestigationFeedbackExportEntry) => b.feedbackId)).toEqual(['f_1', 'f_2', 'f_3']);
    expect(batch.map((b: InvestigationFeedbackExportEntry) => b.mappedCode)).toEqual(['ok', 'low_confidence', 'incomplete']);
  });

  it('does not deduplicate — duplicate feedbackIds stay separate', () => {
    const rows = [
      { tenantId: 't1', feedbackId: 'f_1', runId: 'r_1', versionId: 'v_1', authorUserId: 'u', label: 'confirmed' as const, submittedAt: '2026-09-07T10:00:00.000Z' },
      { tenantId: 't1', feedbackId: 'f_1', runId: 'r_1', versionId: 'v_1', authorUserId: 'u', label: 'confirmed' as const, submittedAt: '2026-09-07T11:00:00.000Z' },
    ];
    const batch = toInvestigationFeedbackExportBatch(rows);
    expect(batch).toHaveLength(2);
    // The eval pipeline must dedup upstream; we keep the raw count.
    expect(batch[0]?.feedbackId).toBe('f_1');
    expect(batch[1]?.feedbackId).toBe('f_1');
  });
});

describe('feedback-export: aggregator (precision contract)', () => {
  function makeEntry(label: 'confirmed' | 'incorrect' | 'insufficient_data', i: number) {
    return {
      schema: INVESTIGATION_FEEDBACK_EXPORT_SCHEMA,
      feedbackId: `f_${i}`,
      tenantId: 't1',
      runId: 'r_1',
      versionId: 'v_1',
      label,
      source: 'investigation-feedback' as const,
      mappedCode: FEEDBACK_TO_VERDICT_CODE[label],
      authorUserId: 'u',
      observedAt: `2026-09-07T10:0${i}:00.000Z`,
    };
  }
  // Build entries that pass the schema parse.
  // Always emit a valid ISO datetime regardless of the index. The
  // naive `10:0${i}:00.000Z` template produced invalid datetimes for
  // i >= 10 because the minute digits bled into the seconds.
  function isoAt(i: number): string {
    return `2026-09-07T10:${String(i % 60).padStart(2, '0')}:00.000Z`;
  }
  function valid(label: 'confirmed' | 'incorrect' | 'insufficient_data', i: number) {
    return toInvestigationFeedbackExport({
      tenantId: 't1',
      feedbackId: `f_${i}`,
      runId: 'r_1',
      versionId: 'v_1',
      label,
      authorUserId: 'u',
      submittedAt: isoAt(i),
    });
  }

  it('returns precision=null below the documented threshold (the spec rule)', () => {
    // 29 confirmed + 1 incorrect = evaluated 30, but the spec says
    // threshold default is 30. We expect `evaluated >= minSampleSize`,
    // so 30 IS calibrated. Use 29 instead.
    const entries = [];
    for (let i = 0; i < 28; i += 1) entries.push(valid('confirmed', i));
    entries.push(valid('incorrect', 28));
    const sum = computeFeedbackSummary(entries);
    expect(sum.total).toBe(29);
    expect(sum.confirmed).toBe(28);
    expect(sum.incorrect).toBe(1);
    expect(sum.evaluated).toBe(29);
    expect(sum.precision).toBeNull();
    expect(sum.isCalibrated).toBe(false);
  });

  it('reports precision above the threshold', () => {
    // 25 confirmed + 5 incorrect = evaluated 30 = threshold met.
    const entries = [];
    for (let i = 0; i < 25; i += 1) entries.push(valid('confirmed', i));
    for (let i = 0; i < 5; i += 1) entries.push(valid('incorrect', 30 + i));
    const sum = computeFeedbackSummary(entries);
    expect(sum.total).toBe(30);
    expect(sum.evaluated).toBe(30);
    expect(sum.isCalibrated).toBe(true);
    expect(sum.precision).not.toBeNull();
    expect(sum.precision).toBeCloseTo(25 / 30, 10);
  });

  it('precision excludes insufficient_data from the denominator', () => {
    // 25 confirmed + 5 incorrect + 100 insufficient_data = evaluated 30
    // (NOT 130). The spec says 'incomplete' must NOT inflate the
    // precision denominator.
    const entries = [];
    for (let i = 0; i < 25; i += 1) entries.push(valid('confirmed', i));
    for (let i = 0; i < 5; i += 1) entries.push(valid('incorrect', 30 + i));
    for (let i = 0; i < 100; i += 1) entries.push(valid('insufficient_data', 100 + i));
    const sum = computeFeedbackSummary(entries);
    expect(sum.total).toBe(130);
    expect(sum.confirmed).toBe(25);
    expect(sum.incorrect).toBe(5);
    expect(sum.insufficient_data).toBe(100);
    expect(sum.evaluated).toBe(30);
    expect(sum.precision).toBeCloseTo(25 / 30, 10);
  });

  it('returns precision=null on an empty batch (no denominator, never invent)', () => {
    const sum = computeFeedbackSummary([]);
    expect(sum.total).toBe(0);
    expect(sum.evaluated).toBe(0);
    expect(sum.precision).toBeNull();
    expect(sum.isCalibrated).toBe(false);
  });

  it('returns precision=null when only insufficient_data rows are present', () => {
    // A batch of 100 'insufficient_data' MUST NOT produce a precision
    // number. The denominator is 0, so the function returns null even
    // though the sample size is over the threshold.
    const entries = [];
    for (let i = 0; i < 100; i += 1) entries.push(valid('insufficient_data', i));
    const sum = computeFeedbackSummary(entries);
    expect(sum.total).toBe(100);
    expect(sum.evaluated).toBe(0);
    expect(sum.precision).toBeNull();
    expect(sum.insufficient_data).toBe(100);
  });

  it('honours a custom minSampleSize', () => {
    // Threshold 50: 25 confirmed + 5 incorrect = evaluated 30 → null.
    const entries = [];
    for (let i = 0; i < 25; i += 1) entries.push(valid('confirmed', i));
    for (let i = 0; i < 5; i += 1) entries.push(valid('incorrect', 30 + i));
    const sum = computeFeedbackSummary(entries, { minSampleSize: 50 });
    expect(sum.isCalibrated).toBe(false);
    expect(sum.precision).toBeNull();
    expect(sum.minSampleSize).toBe(50);
  });

  it('detects a mixed-tenant batch and sets tenantId=null (caller bug signal)', () => {
    // The aggregator counts honestly even when the contract is broken;
    // it sets tenantId=null so a downstream UI can show "mixed batch".
    const a = valid('confirmed', 0);
    const b = toInvestigationFeedbackExport({
      tenantId: 't2',
      feedbackId: 'f_other',
      runId: 'r_other',
      versionId: 'v_other',
      label: 'confirmed',
      authorUserId: 'u',
      submittedAt: new Date('2026-09-07T10:00:00.000Z'),
    });
    const sum = computeFeedbackSummary([a, b]);
    expect(sum.tenantId).toBeNull();
    expect(sum.confirmed).toBe(2);
  });

  it('exposes the documented default min sample size (30)', () => {
    expect(DEFAULT_MIN_SAMPLE_SIZE).toBe(30);
  });
});

describe('feedback-export: discrimination from VerdictLog', () => {
  it('the source discriminator lets consumers route this entry separately', () => {
    // Phase F-5.1 writes VerdictLog rows with `toolName`; the eval
    // nightly leg must NOT confuse a feedback export entry with a
    // VerdictLog row. The discriminator is the literal source.
    const fb = toInvestigationFeedbackExport({
      tenantId: 't1',
      feedbackId: 'f_1',
      runId: 'r_1',
      versionId: 'v_1',
      label: 'confirmed',
      authorUserId: 'u',
      submittedAt: new Date('2026-09-07T10:00:00.000Z'),
    });
    expect(fb.source).toBe('investigation-feedback');
    expect(fb).not.toHaveProperty('toolName');
    expect(fb).not.toHaveProperty('messageId');
  });
});
