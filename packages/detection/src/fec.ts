import type { Finding, DeviceKind, NumericSample } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface FecDegradationOptions {
  now?: number;
  /** Observation window (ms). */
  windowMs?: number;
  /** Minimum corrected samples required before a warning is emitted. */
  minSamples?: number;
  /** Any uncorrectable delta above this (default 0) is critical. */
  uncorrectedThreshold?: number;
  /** Corrected delta over the window above this is a warning. */
  correctedDeltaThreshold?: number;
}

function windowed(samples: NumericSample[], now: number, windowMs: number): NumericSample[] {
  return samples
    .filter((s) => s.t >= now - windowMs && s.t <= now)
    .sort((a, b) => a.t - b.t);
}

/** Monotonic-counter delta over the window; 0 when < 2 samples or counter reset. */
function counterDelta(series: NumericSample[]): number {
  if (series.length < 2) return 0;
  return Math.max(0, series[series.length - 1]!.v - series[0]!.v);
}

/**
 * Detects FEC (forward error correction) degradation on an ONU/OLT.
 *
 * `corrected` and `uncorrected` are cumulative counters. Uncorrectable
 * codewords are actual data errors — the fiber/optical budget is already
 * failing — so any positive delta is critical. A corrected-count delta above
 * the threshold is the earlier, still-recoverable warning: the fiber is
 * degrading before Rx power crosses the offline threshold.
 */
export function detectFecDegradation(
  deviceKind: DeviceKind,
  deviceId: string,
  corrected: NumericSample[],
  uncorrected: NumericSample[],
  opts: FecDegradationOptions = {},
): Finding | null {
  const now = opts.now ?? Date.now();
  const windowMs = opts.windowMs ?? DAY_MS;
  const minSamples = opts.minSamples ?? 3;
  const uncorrectedThreshold = opts.uncorrectedThreshold ?? 0;
  const correctedDeltaThreshold = opts.correctedDeltaThreshold ?? 100;

  const correctedWindow = windowed(corrected, now, windowMs);
  const uncorrectedWindow = windowed(uncorrected, now, windowMs);

  const correctedDelta = counterDelta(correctedWindow);
  const uncorrectedDelta = counterDelta(uncorrectedWindow);

  if (uncorrectedDelta > uncorrectedThreshold) {
    return {
      id: `fec-degradation-${deviceKind}-${deviceId}`,
      kind: 'fec_degradation',
      severity: 'critical',
      deviceKind,
      deviceId,
      title: `FEC no corregido en ${deviceId}`,
      description:
        `${uncorrectedDelta} codewords FEC no corregidos en la última ventana — degradación óptica activa.`,
      detectedAt: new Date(now).toISOString(),
    };
  }

  if (correctedWindow.length >= minSamples && correctedDelta > correctedDeltaThreshold) {
    return {
      id: `fec-degradation-${deviceKind}-${deviceId}`,
      kind: 'fec_degradation',
      severity: 'warning',
      deviceKind,
      deviceId,
      title: `FEC en aumento: ${deviceId}`,
      description:
        `${correctedDelta} codewords FEC corregidos en la última ventana — la fibra se está degradando.`,
      detectedAt: new Date(now).toISOString(),
    };
  }

  return null;
}
