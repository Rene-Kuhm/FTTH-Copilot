import type { MetricPoint, SampleMeta } from './types';

export interface ScenarioOptions {
  /** Fixed reference time (defaults to now). Used for deterministic tests. */
  now?: Date;
  /** Number of samples per metric. */
  samples?: number;
  /** Hours between samples. */
  intervalHours?: number;
}

/**
 * Builds a synthetic ONU degradation scenario for hardware-free NOC testing.
 *
 * Over `samples` points it simulates, on a single ONU:
 *   - RX power drifting from -22.0 toward the offline threshold (-27 dBm)
 *     but NOT crossing it within the window — so `detectSignalDrift` can
 *     predict the future crossing with a positive ETA.
 *   - FEC corrected counters growing past the warning threshold.
 *   - FEC uncorrectable codewords appearing in the final third (critical).
 *   - Bias current sagging below the healthy band in the recent window so
 *     `detectOpticalDegradation` triggers on `recentAverage`.
 *
 * The result is the flat MetricPoint[] that the real pipeline persists and
 * detects — the exact input `runDetection` consumes.
 */
export function buildNocDegradationScenario(
  meta: SampleMeta,
  opts: ScenarioOptions = {},
): MetricPoint[] {
  const now = opts.now ?? new Date();
  const n = opts.samples ?? 12;
  const stepMs = (opts.intervalHours ?? 6) * 60 * 60 * 1000;
  const deviceId = 'onu-scenario-1';
  const points: MetricPoint[] = [];

  for (let i = 0; i < n; i++) {
    const sampledAt = new Date(now.getTime() - (n - 1 - i) * stepMs).toISOString();
    const t = i / (n - 1); // 0..1 progression

    // RX drifts toward -27 but stays above it: predictThresholdCrossing
    // returns a positive ETA instead of null ("already past threshold").
    const rxPowerDbm = -22.0 + t * -3.0; // -22.0 → -25.0
    const fecCorrected = Math.round(t * 300); // 0 → 300
    const lastThirdStart = Math.floor((n * 2) / 3);
    const fecUncorrected = i >= lastThirdStart ? (i - lastThirdStart + 1) * 2 : 0;
    // Bias sags exponentially so the recent (24h) average drops below the healthy
    // floor (2 mA) and `detectOpticalDegradation` triggers. A linear ramp keeps
    // the early samples inside the safe band, which would otherwise pull the
    // recent-average above the threshold.
    const biasCurrentMa = round(14 * Math.exp(-3.5 * t)); // 14 → 0.4

    points.push(
      { ...meta, deviceKind: 'ONU', deviceId, kind: 'RX_POWER_DBM', value: round(rxPowerDbm), sampledAt },
      { ...meta, deviceKind: 'ONU', deviceId, kind: 'FEC_CORRECTED', value: fecCorrected, sampledAt },
      { ...meta, deviceKind: 'ONU', deviceId, kind: 'FEC_UNCORRECTED', value: fecUncorrected, sampledAt },
      { ...meta, deviceKind: 'ONU', deviceId, kind: 'BIAS_CURRENT_MA', value: round(biasCurrentMa), sampledAt },
    );
  }

  return points;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
