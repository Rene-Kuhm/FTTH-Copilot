import { mad, median } from './stats';
import type { Finding, NumericSample, DeviceKind } from './types';

const ROBUST_SIGMA = 1.4826; // converts MAD to a consistent estimator of stddev

export interface AnomalyOptions {
  minSamples?: number;
  /** Robust z-score threshold above which the latest sample is anomalous. */
  thresholdZ?: number;
  now?: number;
}

/**
 * Flags a step change in the latest sample vs. the device's own robust baseline
 * (median + MAD). Catches abrupt degradations that a slow trend might miss, and
 * shifts that thresholds alone cannot catch because they are still "in range".
 */
export function detectBaselineAnomaly(
  deviceKind: DeviceKind,
  deviceId: string,
  samples: NumericSample[],
  opts: AnomalyOptions = {},
): Finding | null {
  const minSamples = opts.minSamples ?? 10;
  const thresholdZ = opts.thresholdZ ?? 3.5;
  const now = opts.now ?? Date.now();

  if (samples.length < minSamples) return null;

  const sorted = [...samples].sort((a, b) => a.t - b.t);
  const values = sorted.map((s) => s.v);
  const med = median(values);
  const scale = mad(values);
  if (scale === 0) return null; // flat history: no reference variability

  const last = sorted[sorted.length - 1]!;
  const z = (last.v - med) / (ROBUST_SIGMA * scale);
  if (Math.abs(z) < thresholdZ) return null;

  const absZ = Math.abs(z);
  return {
    id: `metric-anomaly-${deviceKind}-${deviceId}`,
    kind: 'metric_anomaly',
    severity: absZ > 5 ? 'critical' : 'warning',
    deviceKind,
    deviceId,
    title: `Anomalía de métrica: ${deviceId}`,
    description:
      `El último valor (${last.v}) está a ${absZ.toFixed(1)} desviaciones robustas ` +
      `de la línea base (mediana ${med}).`,
    confidence: Math.min(1, absZ / (2 * thresholdZ)),
    detectedAt: new Date(now).toISOString(),
  };
}
