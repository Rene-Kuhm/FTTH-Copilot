/**
 * Property-based invariants for `@ftth-copilot/detection` statistical core and
 * threshold-crossing prediction.
 *
 * Reproducibility: every property uses an explicit fixed seed (`SEED = 20260923`)
 * and bounded run count (`RUNS = 200`). Override `PBT_SEED` only for local
 * debugging; default runs are strictly deterministic.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  DAY_MS,
  fitTrend,
  mad,
  mean,
  median,
  predictThresholdCrossing,
  type NumericSample,
} from '../../src';

const SEED = Number(process.env.PBT_SEED ?? 20260923);
const RUNS = 200;
const BASE_NOW = 1_752_000_000_000;

const normalizeNegZero = (v: number): number => (Object.is(v, -0) ? 0 : v);

const finiteNumberArb = fc
  .double({ noNaN: true, noDefaultInfinity: true })
  .map(normalizeNegZero);

const boundedFloatArb = fc
  .double({ min: -1e6, max: 1e6, noNaN: true })
  .map(normalizeNegZero);

function permutedPairArb<T>(
  itemArb: fc.Arbitrary<T>,
  minLength: number,
  maxLength: number,
): fc.Arbitrary<readonly [T[], T[]]> {
  return fc.array(itemArb, { minLength, maxLength }).chain((items) =>
    fc
      .shuffledSubarray(items, {
        minLength: items.length,
        maxLength: items.length,
      })
      .map((permuted) => [items, permuted] as const),
  );
}

describe('statistical core & trend prediction properties', () => {
  it('D1 (median & mad): median and mad are permutation-invariant over multisets of finite numbers', () => {
    fc.assert(
      fc.property(permutedPairArb(finiteNumberArb, 1, 40), ([xs, perm]) => {
        expect(median(perm)).toBe(median(xs));
        expect(mad(perm)).toBe(mad(xs));
      }),
      { seed: SEED, numRuns: RUNS },
    );
  });

  it('D1 (mean): mean is permutation-invariant over safe-sum integers and within IEEE-754 rounding tolerance over bounded floats', () => {
    fc.assert(
      fc.property(
        permutedPairArb(
          fc.integer({ min: -1_000_000_000, max: 1_000_000_000 }),
          1,
          50,
        ),
        ([xs, perm]) => {
          expect(mean(perm)).toBe(mean(xs));
        },
      ),
      { seed: SEED, numRuns: RUNS },
    );

    fc.assert(
      fc.property(permutedPairArb(boundedFloatArb, 1, 50), ([xs, perm]) => {
        const maxAbs = Math.max(1, ...xs.map(Math.abs));
        const tolerance = xs.length * Number.EPSILON * maxAbs;
        expect(Math.abs(mean(perm) - mean(xs))).toBeLessThanOrEqual(tolerance);
      }),
      { seed: SEED, numRuns: RUNS },
    );
  });

  it('D2: median, mean, and mad never mutate the input array', () => {
    fc.assert(
      fc.property(
        fc.array(finiteNumberArb, { minLength: 0, maxLength: 40 }),
        (xs) => {
          const snapshot = [...xs];
          median(xs);
          mean(xs);
          mad(xs);
          expect(xs).toEqual(snapshot);
        },
      ),
      { seed: SEED, numRuns: RUNS },
    );
  });

  it('D3: median of a non-empty bounded finite list lies within [min, max]', () => {
    // Bounded to [-MAX_VALUE / 2, MAX_VALUE / 2] so (a + b) / 2 in stats.ts cannot overflow to Infinity.
    const safeMidpointFloatArb = fc
      .double({
        min: -Number.MAX_VALUE / 2,
        max: Number.MAX_VALUE / 2,
        noNaN: true,
      })
      .map(normalizeNegZero);

    fc.assert(
      fc.property(
        fc.array(safeMidpointFloatArb, { minLength: 1, maxLength: 50 }),
        (xs) => {
          const m = median(xs);
          const min = xs.reduce((a, b) => (b < a ? b : a), xs[0]!);
          const max = xs.reduce((a, b) => (b > a ? b : a), xs[0]!);
          expect(m).toBeGreaterThanOrEqual(min);
          expect(m).toBeLessThanOrEqual(max);
        },
      ),
      { seed: SEED, numRuns: RUNS },
    );
  });

  it('D4: mad of a non-empty finite list is non-negative and equals 0 for equal values within [-MAX_VALUE / 2, MAX_VALUE / 2]', () => {
    // Note: the converse ("mad === 0 => all values equal") is false for MAD (e.g. [0, 0, 1] has mad === 0).
    // Constant-list mad === 0 is bounded to [-MAX_VALUE / 2, MAX_VALUE / 2] because stats.ts:10-11 computes
    // even-length median as (a + b) / 2, which overflows to ±Infinity once |value| > MAX_VALUE / 2.
    const safeMidpointFloatArb = fc
      .double({
        min: -Number.MAX_VALUE / 2,
        max: Number.MAX_VALUE / 2,
        noNaN: true,
      })
      .map(normalizeNegZero);

    fc.assert(
      fc.property(
        fc.array(finiteNumberArb, { minLength: 1, maxLength: 40 }),
        (xs) => {
          expect(mad(xs)).toBeGreaterThanOrEqual(0);
        },
      ),
      { seed: SEED, numRuns: RUNS },
    );

    fc.assert(
      fc.property(
        safeMidpointFloatArb,
        fc.integer({ min: 1, max: 30 }),
        (value, len) => {
          const constant = Array.from({ length: len }, () => value);
          expect(mad(constant)).toBe(0);
        },
      ),
      { seed: SEED, numRuns: RUNS },
    );
  });

  it('D4 (known numeric limit): median and mad overflow above MAX_VALUE/2', () => {
    // Characterization test pinning the numerical limit in packages/detection/src/stats.ts:10-11:
    // even-length median computes (a + b) / 2 directly, so any even-length constant list with
    // value > Number.MAX_VALUE / 2 overflows (value + value) to Infinity, making both median
    // and mad return Infinity instead of value and 0.
    const aboveHalfMaxArb = fc
      .double({
        min: (Number.MAX_VALUE / 2) * (1 + Number.EPSILON / 2),
        max: Number.MAX_VALUE,
        noNaN: true,
      })
      .filter((v) => v > Number.MAX_VALUE / 2);
    const evenLengthArb = fc.integer({ min: 1, max: 15 }).map((k) => k * 2);

    fc.assert(
      fc.property(aboveHalfMaxArb, evenLengthArb, (value, len) => {
        const constant = Array.from({ length: len }, () => value);
        expect(median(constant)).toBe(Infinity);
        expect(mad(constant)).toBe(Infinity);
      }),
      { seed: SEED, numRuns: RUNS },
    );
  });

  it('D5 (null cases): fitTrend returns null for fewer than two samples and for samples without time spread', () => {
    // Note: r2 in [0, 1] is omitted because stats.ts:71 leaves r2 unclamped and can return r2 < 0 on constant non-dyadic values.
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            t: fc.integer({ min: BASE_NOW - 30 * DAY_MS, max: BASE_NOW }),
            v: boundedFloatArb,
          }),
          { minLength: 0, maxLength: 1 },
        ),
        (samples) => {
          expect(fitTrend(samples)).toBeNull();
        },
      ),
      { seed: SEED, numRuns: RUNS },
    );

    fc.assert(
      fc.property(
        fc.integer({ min: BASE_NOW - 30 * DAY_MS, max: BASE_NOW }),
        fc.array(boundedFloatArb, { minLength: 2, maxLength: 30 }),
        (sameInstant, values) => {
          const samples: NumericSample[] = values.map((v) => ({
            t: sameInstant,
            v,
          }));
          expect(fitTrend(samples)).toBeNull();
        },
      ),
      { seed: SEED, numRuns: RUNS },
    );
  });

  it('D6: fitTrend recovers the slope of a perfectly linear series within 1e-6 and reports r2 === 1 for non-zero slopes', () => {
    // Slope recovery holds across all slopes in [-1e4, 1e4]; r2 === 1 is restricted to |slopePerDay| >= 1e-4
    // because slopePerDay === 0 with non-dyadic constants can yield r2 !== 1 (e.g. 0 or < 0) in stats.ts:62-71.
    fc.assert(
      fc.property(
        fc.double({ min: -1e4, max: 1e4, noNaN: true }).map(normalizeNegZero),
        fc.double({ min: -1e4, max: 1e4, noNaN: true }).map(normalizeNegZero),
        fc.uniqueArray(fc.integer({ min: 0, max: 30 * 24 * 60 }), {
          minLength: 2,
          maxLength: 25,
        }),
        (intercept, slopePerDay, minuteOffsets) => {
          const t0 = BASE_NOW - 30 * DAY_MS;
          const samples: NumericSample[] = minuteOffsets.map((mins) => {
            const t = t0 + mins * 60_000;
            const xDays = (t - t0) / DAY_MS;
            return { t, v: intercept + slopePerDay * xDays };
          });

          const snap = samples.map((s) => ({ ...s }));
          const fit = fitTrend(samples);
          expect(samples).toEqual(snap);
          expect(fit).not.toBeNull();
          expect(Math.abs(fit!.slopePerDay - slopePerDay)).toBeLessThan(1e-6);
        },
      ),
      { seed: SEED, numRuns: RUNS },
    );

    fc.assert(
      fc.property(
        fc.double({ min: -1e4, max: 1e4, noNaN: true }).map(normalizeNegZero),
        fc.double({ min: 1e-4, max: 1e4, noNaN: true }),
        fc.boolean(),
        fc.uniqueArray(fc.integer({ min: 0, max: 30 * 24 * 60 }), {
          minLength: 2,
          maxLength: 25,
        }),
        (intercept, absSlope, negative, minuteOffsets) => {
          const slopePerDay = negative ? -absSlope : absSlope;
          const t0 = BASE_NOW - 30 * DAY_MS;
          const samples: NumericSample[] = minuteOffsets.map((mins) => {
            const t = t0 + mins * 60_000;
            const xDays = (t - t0) / DAY_MS;
            return { t, v: intercept + slopePerDay * xDays };
          });

          const fit = fitTrend(samples);
          expect(fit).not.toBeNull();
          expect(fit!.r2).toBe(1);
        },
      ),
      { seed: SEED, numRuns: RUNS },
    );
  });

  it('P1 (predictThresholdCrossing): obeys minSamples, directional constraints, and bounded positive ETA within horizon', () => {
    const sampleArb = fc.record({
      t: fc.integer({ min: BASE_NOW - 30 * DAY_MS, max: BASE_NOW }),
      v: fc.double({ min: -100, max: 120, noNaN: true }).map(normalizeNegZero),
    });

    fc.assert(
      fc.property(
        fc.array(sampleArb, { minLength: 0, maxLength: 25 }),
        fc.double({ min: -50, max: 80, noNaN: true }),
        fc.constantFrom<'below' | 'above'>('below', 'above'),
        fc.integer({ min: 1, max: 30 }),
        fc.integer({ min: 2, max: 10 }),
        (samples, threshold, direction, horizonDays, minSamples) => {
          const opts = {
            threshold,
            direction,
            horizonDays,
            minSamples,
            minR2: 0.5,
          };
          const pred = predictThresholdCrossing(samples, opts);
          if (samples.length < minSamples) {
            expect(pred).toBeNull();
            return;
          }
          if (pred === null) return;
          expect(pred.etaMs).toBeGreaterThan(0);
          expect(pred.etaMs).toBeLessThanOrEqual(horizonDays * DAY_MS);
          expect(pred.confidence).toBeGreaterThanOrEqual(opts.minR2);
          expect(pred.confidence).toBeLessThanOrEqual(1);
          if (direction === 'below') {
            expect(pred.slopePerDay).toBeLessThan(0);
            expect(pred.lastValue).toBeGreaterThan(threshold);
          } else {
            expect(pred.slopePerDay).toBeGreaterThan(0);
            expect(pred.lastValue).toBeLessThan(threshold);
          }
        },
      ),
      { seed: SEED, numRuns: RUNS },
    );
  });
});
