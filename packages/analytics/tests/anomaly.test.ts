import { describe, it, expect } from 'vitest';
import {
  seasonalDecompose,
  robustZScore,
  median,
  medianAbsoluteDeviation,
  detectAnomalies,
} from '../src/anomaly';

/** Deterministic pseudo-random so every run sees identical input. */
function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

describe('median', () => {
  it('returns the middle value of an odd-length sample', () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it('averages the two middle values of an even-length sample', () => {
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it('returns NaN for an empty sample rather than throwing', () => {
    expect(median([])).toBeNaN();
  });
});

describe('medianAbsoluteDeviation', () => {
  it('is zero for a constant sample', () => {
    expect(medianAbsoluteDeviation([5, 5, 5, 5], 5)).toBe(0);
  });

  it('is invariant to a constant offset when centred on the sample median', () => {
    // Passing an explicit center measures distance from THAT point, so offset
    // invariance is only a property of the default (median) centring.
    const base = [10, 12, 14, 16, 18];
    const shifted = base.map((v) => v + 1000);
    expect(medianAbsoluteDeviation(shifted)).toBeCloseTo(
      medianAbsoluteDeviation(base),
      10,
    );
  });
});

describe('robustZScore', () => {
  it('scores a large outlier far above the bulk of the sample', () => {
    const values = [...Array(40).fill(10), 90];
    const { scores } = robustZScore(values);
    expect(scores[40]).toBeGreaterThan(6);
    expect(Math.max(...scores.slice(0, 40))).toBeLessThan(3);
  });

  it('falls back to standard deviation when the MAD collapses to zero', () => {
    // Mostly identical values with a couple of differing ones: MAD is 0, so a
    // divide-by-zero would otherwise produce Infinity for every point.
    const values = [5, 5, 5, 5, 5, 5, 5, 8];
    const { scores } = robustZScore(values);
    expect(scores.every((s) => Number.isFinite(s))).toBe(true);
  });

  it('returns all-zero scores for a perfectly flat series', () => {
    const { scores } = robustZScore([7, 7, 7, 7, 7]);
    expect(scores.every((s) => s === 0)).toBe(true);
  });
});

describe('seasonalDecompose', () => {
  it('recovers a known daily seasonal profile from a longer-than-one-period series', () => {
    const perDay = 24;
    const days = 7;
    const phase = new Array(perDay).fill(0).map((_, h) => Math.sin((2 * Math.PI * h) / perDay));
    const series = Array.from({ length: perDay * days }, (_, i) => 50 + 10 * phase[i % perDay]);

    const { residual } = seasonalDecompose(series, perDay);

    // A clean seasonal signal leaves almost nothing in the residual.
    const spread = Math.max(...residual) - Math.min(...residual);
    expect(spread).toBeLessThan(1e-6);
  });

  it('removes a linear trend into the trend component', () => {
    const series = Array.from({ length: 48 }, (_, i) => i);
    const { trend } = seasonalDecompose(series, 24);
    expect(trend[0]).toBeLessThan(trend[47]);
  });

  it('tolerates a series shorter than one full period', () => {
    const { residual, seasonal } = seasonalDecompose([1, 2, 3], 24);
    expect(residual).toHaveLength(3);
    expect(seasonal).toHaveLength(3);
  });
});

describe('detectAnomalies', () => {
  /** One day of hourly points with a daily sine and small bounded noise. */
  function baseline(days: number, perDay: number, seed: number): number[] {
    const rnd = prng(seed);
    return Array.from({ length: days * perDay }, (_, i) => {
      const seasonal = 20 * Math.sin((2 * Math.PI * (i % perDay)) / perDay);
      return 100 + seasonal + (rnd() - 0.5) * 2;
    });
  }

  it('flags a sustained multi-hour spike but not the quiet baseline', () => {
    const perDay = 24;
    const series = baseline(7, perDay, 42);
    // A six-hour outage beginning at 03:00 on day 5.
    const start = 4 * perDay + 3;
    for (let i = 0; i < 6; i += 1) series[start + i] += 120;

    const anomalies = detectAnomalies(series, { pointsPerDay: perDay, zThreshold: 3.5 });

    expect(anomalies.length).toBeGreaterThan(0);
    const flagged = anomalies.some((a) => a.index >= start && a.index < start + 6);
    expect(flagged).toBe(true);
    // A clean week should not produce anomalies everywhere.
    expect(anomalies.length).toBeLessThan(series.length / 4);
  });

  it('returns no anomalies for a stable series', () => {
    const perDay = 24;
    const anomalies = detectAnomalies(baseline(7, perDay, 7), {
      pointsPerDay: perDay,
      zThreshold: 4,
    });
    expect(anomalies).toHaveLength(0);
  });

  it('caps the seasonal period when the series is far shorter than one cycle', () => {
    // Regression: a 1440-point daily period over a 117-point series used to give each
    // phase bucket a single sample, so the profile equalled the signal, the residual
    // collapsed to zero, and nothing was ever detected. The period must be capped to
    // what the data supports, otherwise the detector is silently blind.
    const series = Array.from({ length: 117 }, (_, i) => 140_000_000 + Math.sin(i / 4) * 2_000_000);
    for (let i = 60; i < 72; i += 1) series[i]! += 40_000_000;

    const anomalies = detectAnomalies(series, { pointsPerDay: 1440, zThreshold: 4, minCommunityLength: 2 });

    expect(anomalies.length).toBeGreaterThan(0);
    expect(anomalies.some((a) => a.index >= 60 && a.index < 72)).toBe(true);
  });

  it('never reports an anomaly on an empty or single-point series', () => {
    expect(detectAnomalies([], { pointsPerDay: 24 })).toEqual([]);
    expect(detectAnomalies([42], { pointsPerDay: 24 })).toEqual([]);
  });

  it('reports both directions with a signed score', () => {
    const perDay = 24;
    const series = baseline(4, perDay, 11);
    const start = 2 * perDay + 5;
    for (let i = 0; i < 8; i += 1) series[start + i] -= 90;

    const anomalies = detectAnomalies(series, { pointsPerDay: perDay, zThreshold: 3 });
    const inWindow = anomalies.filter((a) => a.index >= start && a.index < start + 8);
    expect(inWindow.length).toBeGreaterThan(0);
    expect(inWindow[0].score).toBeLessThan(0);
  });
});
