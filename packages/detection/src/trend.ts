import { DAY_MS, fitTrend } from './stats';
import type { NumericSample } from './types';

export interface CrossingOptions {
  threshold: number;
  /** 'below': failure when the value drops under threshold (e.g. signal). 'above': failure when it rises over threshold (e.g. temperature). */
  direction: 'below' | 'above';
  horizonDays: number;
  minSamples: number;
  minR2: number;
}

export interface CrossingPrediction {
  etaMs: number;
  slopePerDay: number;
  /** r2 of the trend, in [0, 1]. */
  confidence: number;
  lastValue: number;
}

/**
 * Predicts when a linear trend will cross `threshold`, returning the ETA only
 * if the crossing happens within the horizon. Returns null when the trend is
 * absent, too weak (r2 below minR2), or already past the threshold.
 */
export function predictThresholdCrossing(
  samples: NumericSample[],
  opts: CrossingOptions,
): CrossingPrediction | null {
  if (samples.length < opts.minSamples) return null;
  const fit = fitTrend(samples);
  if (!fit) return null;
  if (fit.r2 < opts.minR2) return null;

  const lastValue = [...samples].sort((a, b) => a.t - b.t)[samples.length - 1]!.v;

  if (opts.direction === 'below') {
    if (fit.slopePerDay >= 0 || lastValue <= opts.threshold) return null;
  } else {
    if (fit.slopePerDay <= 0 || lastValue >= opts.threshold) return null;
  }

  const etaDays = (opts.threshold - lastValue) / fit.slopePerDay;
  const etaMs = etaDays * DAY_MS;
  if (etaMs > opts.horizonDays * DAY_MS) return null;

  return { etaMs, slopePerDay: fit.slopePerDay, confidence: fit.r2, lastValue };
}
