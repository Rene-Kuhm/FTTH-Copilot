import type { Finding, DeviceKind, NumericSample } from './types';

const MINUTE_MS = 60 * 1000;

export interface TrafficDetectorOptions {
  now?: number;
  /** Observation window (ms). */
  windowMs?: number;
  /** Sustained throughput (Mbps) above which a device is flagged. */
  thresholdMbps?: number;
  /** Minimum samples required before a finding is emitted. */
  minSamples?: number;
}

/**
 * Detects sustained high throughput on a device — the classic "compromised
 * CPE" signal (sustained e.g. a botnet member). Severity escalates to critical
 * at 2x the threshold.
 */
export function detectTrafficAnomaly(
  deviceKind: DeviceKind,
  deviceId: string,
  samples: NumericSample[],
  opts: TrafficDetectorOptions = {},
): Finding | null {
  const now = opts.now ?? Date.now();
  const windowMs = opts.windowMs ?? 15 * MINUTE_MS;
  const threshold = opts.thresholdMbps ?? 100;
  const minSamples = opts.minSamples ?? 3;

  const recent = samples.filter((s) => s.t >= now - windowMs && s.t <= now);
  if (recent.length < minSamples) return null;

  const avg = recent.reduce((sum, s) => sum + s.v, 0) / recent.length;
  if (avg <= threshold) return null;

  return {
    id: `traffic-anomaly-${deviceKind}-${deviceId}`,
    kind: 'traffic_anomaly',
    severity: avg >= threshold * 2 ? 'critical' : 'warning',
    deviceKind,
    deviceId,
    title: `Tráfico anómalo en ${deviceId}`,
    description:
      `Promedio de ${avg.toFixed(1)} Mbps en los últimos ${Math.round(windowMs / MINUTE_MS)} min (umbral ${threshold} Mbps).`,
    detectedAt: new Date(now).toISOString(),
  };
}
