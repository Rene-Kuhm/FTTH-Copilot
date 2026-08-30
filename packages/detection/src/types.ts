/**
 * Pure, DB-agnostic types for early-warning detection. Detectors consume
 * in-memory time series and return Findings; the alert layer (persistence,
 * dedup, notification) lives elsewhere.
 */

export type DeviceKind = 'OLT' | 'ONU';
export type Severity = 'warning' | 'critical';

/** A numeric metric sample (rx/tx power, temperature, uptime, ...). */
export interface NumericSample {
  /** Unix epoch milliseconds. */
  t: number;
  /** Metric value. */
  v: number;
}

/** A categorical status sample. */
export interface StatusSample {
  /** Unix epoch milliseconds. */
  t: number;
  status: 'online' | 'offline' | 'degraded';
}

/** A monotonic uptime counter sample (seconds since boot). */
export interface UptimeSample {
  /** Unix epoch milliseconds. */
  t: number;
  uptimeSeconds: number;
}

export type FindingKind =
  | 'predicted_low_signal'
  | 'predicted_high_temperature'
  | 'intermittent_connection'
  | 'frequent_reboots'
  | 'metric_anomaly';

export interface Finding {
  /** Stable id (per kind + device) used for dedup/cooldown. */
  id: string;
  kind: FindingKind;
  severity: Severity;
  deviceKind: DeviceKind;
  deviceId: string;
  title: string;
  description: string;
  /** Predicted time until the failure (ms), for predictive findings. */
  etaMs?: number;
  /** Confidence in [0, 1] where meaningful (r2 or z-score based). */
  confidence?: number;
  /** ISO-8601 timestamp of detection. */
  detectedAt: string;
}
