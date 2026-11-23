/**
 * Property-based tests for evidence collection, freshness quality, counter resets,
 * and confirmed-incident retrieval in `@ftth-copilot/evidence`.
 *
 * Reproducibility: every property uses `SEED = 20260923` and `RUNS = 200`.
 * Covered invariants: E-7, E-8, E-9, E-10, E-11.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  MAX_INVESTIGATION_EVIDENCE_REFS,
  MAX_INVESTIGATION_WINDOW_DAYS,
  investigationEvidenceRefSchema,
} from '@ftth-copilot/shared';
import {
  MissingTenantError as CollectorMissingTenantError,
  collectInvestigationEvidence,
} from '../../src/evidence-collector';
import {
  assessFreshness,
  detectCounterReset,
  type QualitySample,
} from '../../src/evidence-quality';
import {
  DEFAULT_LIMIT,
  MIN_SPARSESCORE,
  MissingTenantError as RetrievalMissingTenantError,
  retrieveRelevantIncidents,
} from '../../src/relevant-incidents';
import {
  BASE_TIME_MS,
  DAY_MS,
  collectEvidenceArgsArb,
  confirmedIncidentArb,
  qualitySamplesArb,
  queryStringArb,
  sourcePolicyArb,
  tenantIdArb,
} from './arbitraries';

const SEED = 20260923;
const RUNS = 200;

describe('Evidence collection, quality & retrieval properties (E-7..E-11)', () => {
  it('E-7: collectInvestigationEvidence isolates target tenant, returns unique schema-valid ids, sorts deterministically, and caps at MAX_INVESTIGATION_EVIDENCE_REFS', () => {
    fc.assert(
      fc.property(collectEvidenceArgsArb, (mixedArgs) => {
        const refs = collectInvestigationEvidence(mixedArgs);

        const targetOnlyArgs = {
          ...mixedArgs,
          metrics: mixedArgs.metrics?.filter((m) => m.tenantId === mixedArgs.tenantId),
          events: mixedArgs.events?.filter((e) => e.tenantId === mixedArgs.tenantId),
          topologyHops: mixedArgs.topologyHops?.filter(
            (h) => h.tenantId === mixedArgs.tenantId,
          ),
          confirmedIncidents: mixedArgs.confirmedIncidents?.filter(
            (inc) => inc.tenantId === mixedArgs.tenantId,
          ),
          feedbacks: mixedArgs.feedbacks?.filter((fb) => fb.tenantId === mixedArgs.tenantId),
        };
        const targetOnlyRefs = collectInvestigationEvidence(targetOnlyArgs);

        // Cross-tenant isolation: foreign-tenant rows never appear or alter output.
        expect(refs).toEqual(targetOnlyRefs);
        expect(refs.length).toBeLessThanOrEqual(MAX_INVESTIGATION_EVIDENCE_REFS);

        const seenIds = new Set<string>();
        for (const ref of refs) {
          expect(investigationEvidenceRefSchema.safeParse(ref).success).toBe(true);
          expect(seenIds.has(ref.evidenceRefId)).toBe(false);
          seenIds.add(ref.evidenceRefId);
        }

        // Documented sort order: observedAt desc, kind asc, evidenceRefId asc.
        for (let i = 0; i < refs.length - 1; i++) {
          const a = refs[i]!;
          const b = refs[i + 1]!;
          const tA = new Date(a.observedAt).getTime();
          const tB = new Date(b.observedAt).getTime();

          const validOrder =
            tA > tB ||
            (tA === tB &&
              (a.kind.localeCompare(b.kind) < 0 ||
                (a.kind.localeCompare(b.kind) === 0 &&
                  a.evidenceRefId.localeCompare(b.evidenceRefId) <= 0)));
          expect(validOrder).toBe(true);
        }
      }),
      { seed: SEED, numRuns: RUNS },
    );

    // Explicitly verify saturation cap when > 64 valid target-tenant items exist.
    fc.assert(
      fc.property(
        tenantIdArb,
        fc.integer({ min: MAX_INVESTIGATION_EVIDENCE_REFS + 1, max: 120 }),
        (tenantId, count) => {
          const start = new Date(BASE_TIME_MS - DAY_MS).toISOString();
          const end = new Date(BASE_TIME_MS).toISOString();
          const metrics = Array.from({ length: count }, (_, i) => ({
            sampleId: `cap-${i}`,
            tenantId,
            deviceId: 'ONU-1',
            metricKind: 'RX_POWER_DBM',
            value: -22,
            recordedAt: new Date(BASE_TIME_MS - i * 1000).toISOString(),
          }));
          const refs = collectInvestigationEvidence({
            tenantId,
            deviceId: 'ONU-1',
            windowStart: start,
            windowEnd: end,
            metrics,
          });
          expect(refs).toHaveLength(MAX_INVESTIGATION_EVIDENCE_REFS);
        },
      ),
      { seed: SEED, numRuns: 50 },
    );
  });

  it('E-8: collectInvestigationEvidence rejects blank tenantId, inverted windows, and windows exceeding MAX_INVESTIGATION_WINDOW_DAYS', () => {
    const validStart = new Date(BASE_TIME_MS - DAY_MS).toISOString();
    const validEnd = new Date(BASE_TIME_MS).toISOString();

    fc.assert(
      fc.property(fc.constantFrom('', ' ', '   ', '\t', '\n'), (blankTenant) => {
        expect(() =>
          collectInvestigationEvidence({
            tenantId: blankTenant,
            deviceId: 'ONU-1',
            windowStart: validStart,
            windowEnd: validEnd,
          }),
        ).toThrow(CollectorMissingTenantError);
      }),
      { seed: SEED, numRuns: 20 },
    );

    fc.assert(
      fc.property(
        tenantIdArb,
        fc.integer({ min: 1, max: 30 * DAY_MS }),
        (tenantId, reverseDeltaMs) => {
          const start = new Date(BASE_TIME_MS).toISOString();
          const end = new Date(BASE_TIME_MS - reverseDeltaMs).toISOString();
          expect(() =>
            collectInvestigationEvidence({
              tenantId,
              deviceId: 'ONU-1',
              windowStart: start,
              windowEnd: end,
            }),
          ).toThrow(/windowEnd/);
        },
      ),
      { seed: SEED, numRuns: RUNS },
    );

    fc.assert(
      fc.property(
        tenantIdArb,
        fc.integer({ min: 1, max: 365 * DAY_MS }),
        (tenantId, excessMs) => {
          const startMs = BASE_TIME_MS - (MAX_INVESTIGATION_WINDOW_DAYS * DAY_MS + excessMs);
          expect(() =>
            collectInvestigationEvidence({
              tenantId,
              deviceId: 'ONU-1',
              windowStart: new Date(startMs).toISOString(),
              windowEnd: validEnd,
            }),
          ).toThrow(/MAX_INVESTIGATION_WINDOW_DAYS/);
        },
      ),
      { seed: SEED, numRuns: RUNS },
    );
  });

  it('E-9: assessFreshness is deterministic for fixed nowMs and returns error/future-sample when any sample exceeds the 60s future clock-skew tolerance', () => {
    fc.assert(
      fc.property(
        qualitySamplesArb(BASE_TIME_MS, -600_000, 120_000),
        sourcePolicyArb,
        (samples, policy) => {
          const r1 = assessFreshness(samples, policy, BASE_TIME_MS);
          const r2 = assessFreshness(samples, policy, BASE_TIME_MS);
          expect(r1).toEqual(r2);
        },
      ),
      { seed: SEED, numRuns: RUNS },
    );

    fc.assert(
      fc.property(
        qualitySamplesArb(BASE_TIME_MS, -300_000, 0),
        fc.integer({ min: 60_001, max: 10_000_000 }),
        sourcePolicyArb,
        (pastSamples, futureExceedMs, policy) => {
          const withFuture: QualitySample[] = [
            ...pastSamples,
            { sampledAt: BASE_TIME_MS + futureExceedMs, value: -20 },
          ];
          const res = assessFreshness(withFuture, policy, BASE_TIME_MS);
          expect(res.level).toBe('error');
          expect(res.reason).toBe('future-sample');
          expect(res.newestAgeMs).toBeNull();
        },
      ),
      { seed: SEED, numRuns: RUNS },
    );
  });

  it('E-10: detectCounterReset returns null for non-decreasing series and the exact index of the first decrease otherwise', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.option(fc.integer({ min: 0, max: 1000 }), { nil: null }),
          { minLength: 0, maxLength: 30 },
        ),
        (deltas) => {
          let running = 0;
          const nonDecreasing: QualitySample[] = deltas.map((d, idx) => {
            if (d === null) {
              return { sampledAt: BASE_TIME_MS + idx * 1000, value: null };
            }
            running += d;
            return { sampledAt: BASE_TIME_MS + idx * 1000, value: running };
          });
          expect(detectCounterReset(nonDecreasing)).toBeNull();
        },
      ),
      { seed: SEED, numRuns: RUNS },
    );

    fc.assert(
      fc.property(
        fc.array(
          fc.option(fc.integer({ min: 0, max: 10_000 }), { nil: null }),
          { minLength: 2, maxLength: 30 },
        ),
        (values) => {
          const samples: QualitySample[] = values.map((v, idx) => ({
            sampledAt: BASE_TIME_MS + idx * 1000,
            value: v,
          }));

          let expectedResetIdx: number | null = null;
          let prev: number | null = null;
          for (let i = 0; i < values.length; i++) {
            const v = values[i];
            if (v === null || v === undefined) continue;
            if (prev !== null && v < prev) {
              expectedResetIdx = i;
              break;
            }
            prev = v;
          }

          expect(detectCounterReset(samples)).toBe(expectedResetIdx);
        },
      ),
      { seed: SEED, numRuns: RUNS },
    );
  });

  it('E-11: retrieveRelevantIncidents isolates by tenantId, enforces limit, orders by descending relevance score, and rejects empty tenantId', () => {
    const now = new Date(BASE_TIME_MS);

    fc.assert(
      fc.property(
        tenantIdArb,
        queryStringArb,
        fc.array(confirmedIncidentArb(), { minLength: 0, maxLength: 30 }),
        fc.option(fc.integer({ min: 1, max: 15 }), { nil: undefined }),
        fc.constantFrom('off' as const, 'shadow' as const, 'active' as const),
        (targetTenant, query, rawIncidents, limit, learningMode) => {
          const confirmedIncidents = rawIncidents.map((inc, idx) => ({
            ...inc,
            id: `inc-${idx}`,
          }));

          const mixedResults = retrieveRelevantIncidents(
            {
              tenantId: targetTenant,
              query,
              limit,
              now,
              confirmedIncidents,
            },
            { learningMode },
          );

          const targetOnlyResults = retrieveRelevantIncidents(
            {
              tenantId: targetTenant,
              query,
              limit,
              now,
              confirmedIncidents: confirmedIncidents.filter(
                (inc) => inc.tenantId === targetTenant,
              ),
            },
            { learningMode },
          );

          // Foreign-tenant rows never leak and never influence target-tenant BM25 avgDocLen or RRF scores.
          expect(mixedResults).toEqual(targetOnlyResults);

          const effectiveLimit = limit ?? DEFAULT_LIMIT;
          expect(mixedResults.length).toBeLessThanOrEqual(effectiveLimit);

          for (let i = 0; i < mixedResults.length; i++) {
            const row = mixedResults[i]!;
            expect(row.tenantId).toBe(targetTenant);
            expect(row.score).toBeGreaterThanOrEqual(MIN_SPARSESCORE);
            expect(row.score).toBeLessThanOrEqual(1);
            if (i > 0) {
              expect(mixedResults[i - 1]!.score).toBeGreaterThan(row.score);
            }
          }
        },
      ),
      { seed: SEED, numRuns: RUNS },
    );

    fc.assert(
      fc.property(queryStringArb, (query) => {
        expect(() =>
          retrieveRelevantIncidents({
            tenantId: '',
            query,
            now,
            confirmedIncidents: [],
          }),
        ).toThrow(RetrievalMissingTenantError);
      }),
      { seed: SEED, numRuns: 20 },
    );
  });
});
