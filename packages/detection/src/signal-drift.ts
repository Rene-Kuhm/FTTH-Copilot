import { predictThresholdCrossing } from './trend';
import type { Finding, NumericSample, DeviceKind } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface SignalDriftOptions {
  /** RX power threshold (dBm) below which the ONU/OLT is at risk. */
  thresholdDbm?: number;
  horizonDays?: number;
  minSamples?: number;
  minR2?: number;
  now?: number;
}

/**
 * Detects a downward RX-power trend that would cross `thresholdDbm` within the
 * horizon. This is the classic FTTH early-warning: signal degradation due to
 * dirty connectors, bends, splices or aging before the ONU goes offline.
 */
export function detectSignalDrift(
  deviceKind: DeviceKind,
  deviceId: string,
  samples: NumericSample[],
  opts: SignalDriftOptions = {},
): Finding | null {
  const threshold = opts.thresholdDbm ?? -27;
  const prediction = predictThresholdCrossing(samples, {
    threshold,
    direction: 'below',
    horizonDays: opts.horizonDays ?? 7,
    minSamples: opts.minSamples ?? 5,
    minR2: opts.minR2 ?? 0.5,
  });
  if (!prediction) return null;

  const etaDays = prediction.etaMs / DAY_MS;
  return {
    id: `predicted-low-signal-${deviceKind}-${deviceId}`,
    kind: 'predicted_low_signal',
    severity: 'warning',
    deviceKind,
    deviceId,
    title: `Señal en caída: ${deviceId}`,
    description:
      `La potencia RX baja a ${prediction.slopePerDay.toFixed(2)} dBm/día y ` +
      `alcanzaría ${threshold} dBm en ~${etaDays.toFixed(1)} día(s).`,
    etaMs: prediction.etaMs,
    confidence: prediction.confidence,
    detectedAt: new Date(opts.now ?? Date.now()).toISOString(),
  };
}
