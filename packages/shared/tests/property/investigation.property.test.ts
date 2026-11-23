/**
 * Property-based tests for cognitive investigation contracts (`S-6`, `S-7`, `S-8` and ID shape).
 *
 * Reproducibility:
 *   - Every property uses an explicit fixed seed (`SEED = 20260923`) and bounded run count
 *     (`RUNS = 150` / `RUNS = 200`), passed directly to `fc.assert`.
 *   - All fixtures are purely synthetic (invented tenant IDs `tenant-*`, invented entity IDs).
 *
 * Invariants verified:
 *   - S-6: `investigationResultSchema` enforces its documented array/numeric caps
 *     (`evidenceRefs <= 64`, `hypotheses <= 8`, `contradictions <= 16`, `missing <= 16`,
 *     `suggestedChecks <= 8`, `forRefIds/againstRefIds <= 64`, `0 < windowDays <= 30`).
 *   - S-7: `investigationFreeTextSchema` enforces `INVESTIGATION_FREE_TEXT_BYTES = 4096`
 *     UTF-8 byte cap (including multi-byte strings whose `.length <= 4096`), both standalone
 *     and inside `investigationResultSchema`.
 *   - S-8: `investigationResultSchema` rejects `windowEnd < windowStart` and `cutoffAt > producedAt`,
 *     while accepting boundary equality (`windowEnd === windowStart` and `cutoffAt === producedAt`).
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  INVESTIGATION_FREE_TEXT_BYTES,
  MAX_INVESTIGATION_CHECKS,
  MAX_INVESTIGATION_CONTRADICTIONS,
  MAX_INVESTIGATION_EVIDENCE_REFS,
  MAX_INVESTIGATION_HYPOTHESES,
  MAX_INVESTIGATION_MISSING,
  MAX_INVESTIGATION_WINDOW_DAYS,
  investigationFeedbackIdSchema,
  investigationFreeTextSchema,
  investigationResultSchema,
  investigationRunIdSchema,
  investigationVersionIdSchema,
} from '../../src/contracts';
import {
  epochMsArb,
  freeTextArb,
  investigationCheckArb,
  investigationContradictionArb,
  investigationEvidenceRefArb,
  investigationHypothesisArb,
  investigationMissingArb,
  investigationResultArb,
} from './arbitraries';

const SEED = 20260923;
const RUNS = 150;
const utf8Encoder = new TextEncoder();

describe('Investigation contract properties (S-6..S-8)', () => {
  describe('S-6: investigationResultSchema documented collection and windowDays caps', () => {
    it('S-6: evidenceRefs accepts length <= 64 and rejects length > 64', () => {
      fc.assert(
        fc.property(
          investigationResultArb,
          investigationEvidenceRefArb,
          fc.integer({ min: 0, max: MAX_INVESTIGATION_EVIDENCE_REFS }),
          (base, refItem, withinCount) => {
            const within = Array.from({ length: withinCount }, (_, i) => ({
              ...refItem,
              evidenceRefId: `ev_${i}`,
            }));
            expect(
              investigationResultSchema.safeParse({ ...base, evidenceRefs: within }).success,
            ).toBe(true);

            const over = Array.from({ length: MAX_INVESTIGATION_EVIDENCE_REFS + 1 }, (_, i) => ({
              ...refItem,
              evidenceRefId: `ev_${i}`,
            }));
            expect(
              investigationResultSchema.safeParse({ ...base, evidenceRefs: over }).success,
            ).toBe(false);
          },
        ),
        { seed: SEED, numRuns: RUNS },
      );
    });

    it('S-6: hypotheses accepts length <= 8 and rejects length > 8', () => {
      fc.assert(
        fc.property(
          investigationResultArb,
          investigationHypothesisArb,
          fc.integer({ min: 0, max: MAX_INVESTIGATION_HYPOTHESES }),
          (base, hypItem, withinCount) => {
            const within = Array.from({ length: withinCount }, (_, i) => ({
              ...hypItem,
              hypothesisId: `h_${i}`,
            }));
            expect(
              investigationResultSchema.safeParse({ ...base, hypotheses: within }).success,
            ).toBe(true);

            const over = Array.from({ length: MAX_INVESTIGATION_HYPOTHESES + 1 }, (_, i) => ({
              ...hypItem,
              hypothesisId: `h_${i}`,
            }));
            expect(
              investigationResultSchema.safeParse({ ...base, hypotheses: over }).success,
            ).toBe(false);
          },
        ),
        { seed: SEED, numRuns: RUNS },
      );
    });

    it('S-6: hypothesis forRefIds and againstRefIds enforce MAX_INVESTIGATION_EVIDENCE_REFS (64)', () => {
      fc.assert(
        fc.property(
          investigationResultArb,
          investigationHypothesisArb,
          fc.constantFrom<'forRefIds' | 'againstRefIds'>('forRefIds', 'againstRefIds'),
          (base, hypItem, field) => {
            const atCap = Array.from(
              { length: MAX_INVESTIGATION_EVIDENCE_REFS },
              (_, i) => `ev_${i}`,
            );
            const overCap = [...atCap, 'ev_overflow'];

            expect(
              investigationResultSchema.safeParse({
                ...base,
                hypotheses: [{ ...hypItem, [field]: atCap }],
              }).success,
            ).toBe(true);

            expect(
              investigationResultSchema.safeParse({
                ...base,
                hypotheses: [{ ...hypItem, [field]: overCap }],
              }).success,
            ).toBe(false);
          },
        ),
        { seed: SEED, numRuns: RUNS },
      );
    });

    it('S-6: contradictions accepts length <= 16 and rejects length > 16', () => {
      fc.assert(
        fc.property(
          investigationResultArb,
          investigationContradictionArb,
          fc.integer({ min: 0, max: MAX_INVESTIGATION_CONTRADICTIONS }),
          (base, item, withinCount) => {
            const within = Array.from({ length: withinCount }, (_, i) => ({
              ...item,
              evidenceRefId: `ev_${i}`,
            }));
            expect(
              investigationResultSchema.safeParse({ ...base, contradictions: within }).success,
            ).toBe(true);

            const over = Array.from({ length: MAX_INVESTIGATION_CONTRADICTIONS + 1 }, (_, i) => ({
              ...item,
              evidenceRefId: `ev_${i}`,
            }));
            expect(
              investigationResultSchema.safeParse({ ...base, contradictions: over }).success,
            ).toBe(false);
          },
        ),
        { seed: SEED, numRuns: RUNS },
      );
    });

    it('S-6: missing accepts length <= 16 and rejects length > 16', () => {
      fc.assert(
        fc.property(
          investigationResultArb,
          investigationMissingArb,
          fc.integer({ min: 0, max: MAX_INVESTIGATION_MISSING }),
          (base, item, withinCount) => {
            const within = Array.from({ length: withinCount }, () => item);
            expect(investigationResultSchema.safeParse({ ...base, missing: within }).success).toBe(
              true,
            );

            const over = Array.from({ length: MAX_INVESTIGATION_MISSING + 1 }, () => item);
            expect(investigationResultSchema.safeParse({ ...base, missing: over }).success).toBe(
              false,
            );
          },
        ),
        { seed: SEED, numRuns: RUNS },
      );
    });

    it('S-6: suggestedChecks accepts length <= 8 and rejects length > 8', () => {
      fc.assert(
        fc.property(
          investigationResultArb,
          investigationCheckArb,
          fc.integer({ min: 0, max: MAX_INVESTIGATION_CHECKS }),
          (base, item, withinCount) => {
            const within = Array.from({ length: withinCount }, (_, i) => ({
              ...item,
              checkId: `c_${i}`,
            }));
            expect(
              investigationResultSchema.safeParse({ ...base, suggestedChecks: within }).success,
            ).toBe(true);

            const over = Array.from({ length: MAX_INVESTIGATION_CHECKS + 1 }, (_, i) => ({
              ...item,
              checkId: `c_${i}`,
            }));
            expect(
              investigationResultSchema.safeParse({ ...base, suggestedChecks: over }).success,
            ).toBe(false);
          },
        ),
        { seed: SEED, numRuns: RUNS },
      );
    });

    it('S-6: windowDays enforces 0 < windowDays <= MAX_INVESTIGATION_WINDOW_DAYS (30)', () => {
      const invalidWindowDaysArb = fc.oneof(
        fc.double({ min: -100, max: 0, noNaN: true, noDefaultInfinity: true }),
        fc.double({
          min: MAX_INVESTIGATION_WINDOW_DAYS + 0.0001,
          max: 1000,
          noNaN: true,
          noDefaultInfinity: true,
        }),
      );

      fc.assert(
        fc.property(investigationResultArb, invalidWindowDaysArb, (base, badDays) => {
          expect(
            investigationResultSchema.safeParse({ ...base, windowDays: badDays }).success,
          ).toBe(false);
        }),
        { seed: SEED, numRuns: RUNS },
      );
    });
  });

  describe('S-7: investigationFreeTextSchema UTF-8 byte cap (4096)', () => {
    it('S-7: accepts any string with UTF-8 byteLength <= 4096 (and length >= minChars)', () => {
      const schema0 = investigationFreeTextSchema(0);
      const schema1 = investigationFreeTextSchema(1);

      fc.assert(
        fc.property(freeTextArb(0, INVESTIGATION_FREE_TEXT_BYTES), (text) => {
          expect(utf8Encoder.encode(text).byteLength).toBeLessThanOrEqual(
            INVESTIGATION_FREE_TEXT_BYTES,
          );
          expect(schema0.parse(text)).toBe(text);
          expect(schema1.safeParse(text).success).toBe(text.length >= 1);
        }),
        { seed: SEED, numRuns: RUNS },
      );
    });

    it('S-7: rejects strings exceeding 4096 UTF-8 bytes even when UTF-16 char count <= 4096', () => {
      const schema0 = investigationFreeTextSchema(0);
      // 2-byte ('á'), 3-byte ('中'), and 4-byte ('🚀') tokens so char length stays <= 4096 while UTF-8 bytes > 4096.
      const multiByteOverCapArb = fc
        .tuple(
          fc.constantFrom(
            { char: 'á', bytes: 2 },
            { char: '中', bytes: 3 },
            { char: '🚀', bytes: 4 },
          ),
          fc.integer({ min: 1, max: 64 }),
        )
        .map(([{ char, bytes }, extraChars]) => {
          const minNeeded = Math.floor(INVESTIGATION_FREE_TEXT_BYTES / bytes) + 1;
          return char.repeat(minNeeded + extraChars);
        });

      fc.assert(
        fc.property(investigationResultArb, multiByteOverCapArb, (base, oversizedText) => {
          expect(utf8Encoder.encode(oversizedText).byteLength).toBeGreaterThan(
            INVESTIGATION_FREE_TEXT_BYTES,
          );
          expect(schema0.safeParse(oversizedText).success).toBe(false);
          expect(
            investigationResultSchema.safeParse({
              ...base,
              sufficiencyReason: oversizedText,
            }).success,
          ).toBe(false);
        }),
        { seed: SEED, numRuns: RUNS },
      );
    });
  });

  describe('S-8: investigationResultSchema window and cutoff temporal invariants', () => {
    it('S-8: rejects windowEnd < windowStart while accepting windowEnd === windowStart', () => {
      fc.assert(
        fc.property(
          investigationResultArb,
          epochMsArb,
          fc.integer({ min: 1, max: 30 * 86_400_000 }),
          (base, startMs, backstepMs) => {
            const windowStart = new Date(startMs).toISOString();

            const equalRes = investigationResultSchema.safeParse({
              ...base,
              windowStart,
              windowEnd: windowStart,
            });
            expect(equalRes.success).toBe(true);

            const invertedRes = investigationResultSchema.safeParse({
              ...base,
              windowStart,
              windowEnd: new Date(startMs - backstepMs).toISOString(),
            });
            expect(invertedRes.success).toBe(false);
            if (!invertedRes.success) {
              expect(
                invertedRes.error.issues.some((issue) => issue.path.includes('windowEnd')),
              ).toBe(true);
            }
          },
        ),
        { seed: SEED, numRuns: RUNS },
      );
    });

    it('S-8: rejects cutoffAt > producedAt while accepting cutoffAt === producedAt', () => {
      fc.assert(
        fc.property(
          investigationResultArb,
          epochMsArb,
          fc.integer({ min: 1, max: 30 * 86_400_000 }),
          (base, producedMs, aheadMs) => {
            const producedAt = new Date(producedMs).toISOString();

            const equalRes = investigationResultSchema.safeParse({
              ...base,
              cutoffAt: producedAt,
              producedAt,
            });
            expect(equalRes.success).toBe(true);

            const futureCutoffRes = investigationResultSchema.safeParse({
              ...base,
              cutoffAt: new Date(producedMs + aheadMs).toISOString(),
              producedAt,
            });
            expect(futureCutoffRes.success).toBe(false);
            if (!futureCutoffRes.success) {
              expect(
                futureCutoffRes.error.issues.some((issue) => issue.path.includes('cutoffAt')),
              ).toBe(true);
            }
          },
        ),
        { seed: SEED, numRuns: RUNS },
      );
    });
  });

  describe('Investigation opaque ASCII IDs round-trip and rejection', () => {
    const idSchemas = [
      { name: 'investigationRunIdSchema', schema: investigationRunIdSchema },
      { name: 'investigationVersionIdSchema', schema: investigationVersionIdSchema },
      { name: 'investigationFeedbackIdSchema', schema: investigationFeedbackIdSchema },
    ] as const;

    it.each(idSchemas)(
      '$name accepts opaque ASCII [A-Za-z0-9_-]{1,64} identically and rejects slashes, spaces, and >64 chars',
      ({ schema }) => {
        const validIdArb = fc.stringMatching(/^[A-Za-z0-9_-]{1,64}$/);
        const invalidIdArb = fc.oneof(
          fc.constant(''),
          fc.stringMatching(/^[A-Za-z0-9_-]{65,80}$/),
          fc.constantFrom('has/slash', 'has space', 'café-1', 'fb:1'),
        );

        fc.assert(
          fc.property(validIdArb, invalidIdArb, (validId, invalidId) => {
            expect(schema.parse(validId)).toBe(validId);
            expect(schema.safeParse(invalidId).success).toBe(false);
          }),
          { seed: SEED, numRuns: RUNS },
        );
      },
    );
  });
});
