import type { NumericSample } from './types';

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Median of a numeric array (does not mutate input). Returns NaN if empty. */
export function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Arithmetic mean of a numeric array. Returns NaN if empty. */
export function mean(values: number[]): number {
  if (values.length === 0) return NaN;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Median absolute deviation — a robust scale estimator. */
export function mad(values: number[]): number {
  const m = median(values);
  return median(values.map((v) => Math.abs(v - m)));
}

export interface TrendFit {
  /** Slope in value units per day. */
  slopePerDay: number;
  intercept: number;
  /** Coefficient of determination, in [0, 1]. 1 = perfect linear fit. */
  r2: number;
}

/**
 * Ordinary least-squares fit of value vs. time (days since the first sample).
 * Samples are sorted by time ascending. Returns null when there are fewer than
 * two points or time has no spread (all samples at the same instant).
 */
export function fitTrend(samples: NumericSample[]): TrendFit | null {
  if (samples.length < 2) return null;
  const sorted = [...samples].sort((a, b) => a.t - b.t);
  const t0 = sorted[0]!.t;
  const n = sorted.length;

  let sx = 0;
  let sy = 0;
  let sxy = 0;
  let sxx = 0;
  for (const s of sorted) {
    const x = (s.t - t0) / DAY_MS;
    sx += x;
    sy += s.v;
    sxy += x * s.v;
    sxx += x * x;
  }

  const denom = n * sxx - sx * sx;
  if (denom === 0) return null;

  const slope = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;

  const yMean = sy / n;
  let ssTot = 0;
  let ssRes = 0;
  for (const s of sorted) {
    const x = (s.t - t0) / DAY_MS;
    const predicted = slope * x + intercept;
    ssTot += (s.v - yMean) ** 2;
    ssRes += (s.v - predicted) ** 2;
  }
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;

  return { slopePerDay: slope, intercept, r2 };
}
