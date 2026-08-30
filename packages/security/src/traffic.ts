import type { SecurityFinding } from './types';

export interface TrafficSample {
  /** Unix epoch milliseconds. */
  t: number;
  /** Throughput in Mbps. */
  v: number;
}

export interface DeviceTraffic {
  deviceKind: 'OLT' | 'ONU';
  deviceId: string;
  samples: TrafficSample[];
}

export interface TrafficDetectorOptions {
  now?: number;
  /** Observation window (ms). */
  windowMs?: number;
  /** Sustained throughput (Mbps) above which a device is flagged. */
  thresholdMbps?: number;
  minSamples?: number;
}

const MINUTE_MS = 60 * 1000;

/**
 * Flags a device whose recent average throughput exceeds `thresholdMbps` — the
 * classic "compromised CPE" signal (sustained egress, e.g. a botnet member).
 * Severity escalates to critical at 2x the threshold.
 */
export function detectTrafficAnomaly(
  devices: DeviceTraffic[],
  opts: TrafficDetectorOptions = {},
): SecurityFinding[] {
  const now = opts.now ?? Date.now();
  const windowMs = opts.windowMs ?? 15 * MINUTE_MS;
  const threshold = opts.thresholdMbps ?? 100;
  const minSamples = opts.minSamples ?? 3;

  const findings: SecurityFinding[] = [];

  for (const device of devices) {
    const recent = device.samples.filter((s) => s.t >= now - windowMs && s.t <= now);
    if (recent.length < minSamples) continue;

    const avg = recent.reduce((sum, s) => sum + s.v, 0) / recent.length;
    if (avg <= threshold) continue;

    findings.push({
      id: `traffic-anomaly-${device.deviceKind}-${device.deviceId}`,
      kind: 'traffic_anomaly',
      severity: avg >= threshold * 2 ? 'critical' : 'warning',
      sourceIp: null,
      title: `Tráfico anómalo en ${device.deviceId}`,
      description: `Promedio de ${avg.toFixed(1)} Mbps en los últimos ${Math.round(windowMs / MINUTE_MS)} min (umbral ${threshold} Mbps).`,
      detectedAt: new Date(now).toISOString(),
    });
  }

  return findings;
}
