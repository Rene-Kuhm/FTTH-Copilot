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
 *   - RX power drifting from -22.0 toward the offline threshold (-27 dBm),
 *   - FEC corrected counters growing (fiber degrading),
 *   - FEC uncorrectable codewords appearing in the final third,
 *   - bias current sagging below the healthy band.
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

    const rxPowerDbm = -22.0 + t * -5.5; // -22.0 → -27.5
    const fecCorrected = Math.round(t * 300); // 0 → 300
    const lastThirdStart = Math.floor((n * 2) / 3);
    const fecUncorrected = i >= lastThirdStart ? (i - lastThirdStart + 1) * 2 : 0;
    const biasCurrentMa = 14 - t * 12.8; // 14 → 1.2

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
