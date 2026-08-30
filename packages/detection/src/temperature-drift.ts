import { predictThresholdCrossing } from './trend';
import type { Finding, NumericSample, DeviceKind } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface TemperatureDriftOptions {
  /** Temperature threshold (°C) above which the OLT is at risk. */
  thresholdCelsius?: number;
  horizonDays?: number;
  minSamples?: number;
  minR2?: number;
  now?: number;
}

/**
 * Detects an upward temperature trend that would cross `thresholdCelsius`
 * within the horizon. Catches cooling failures (fans, airflow, dust) before the
 * OLT reaches a thermal shutdown or degraded state.
 */
export function detectTemperatureDrift(
  deviceKind: DeviceKind,
  deviceId: string,
  samples: NumericSample[],
  opts: TemperatureDriftOptions = {},
): Finding | null {
  const threshold = opts.thresholdCelsius ?? 60;
  const prediction = predictThresholdCrossing(samples, {
    threshold,
    direction: 'above',
    horizonDays: opts.horizonDays ?? 7,
    minSamples: opts.minSamples ?? 5,
    minR2: opts.minR2 ?? 0.5,
  });
  if (!prediction) return null;

  const etaDays = prediction.etaMs / DAY_MS;
  return {
    id: `predicted-high-temperature-${deviceKind}-${deviceId}`,
    kind: 'predicted_high_temperature',
    severity: 'warning',
    deviceKind,
    deviceId,
    title: `Temperatura en ascenso: ${deviceId}`,
    description:
      `La temperatura sube a ${prediction.slopePerDay.toFixed(2)} °C/día y ` +
      `alcanzaría ${threshold} °C en ~${etaDays.toFixed(1)} día(s).`,
    etaMs: prediction.etaMs,
    confidence: prediction.confidence,
    detectedAt: new Date(opts.now ?? Date.now()).toISOString(),
  };
}
