import type { FindingKind } from '@ftth-copilot/detection';

export type AlertStatus = 'open' | 'acknowledged' | 'resolved';
export type DeviceKind = 'OLT' | 'ONU';
export type MetricKind =
  | 'RX_POWER_DBM'
  | 'TX_POWER_DBM'
  | 'TEMPERATURE_CELSIUS'
  | 'UPTIME_SECONDS'
  | 'STATUS';
export type DeviceStatus = 'online' | 'offline' | 'degraded';

/** A single metric sample row, mirroring the MetricSample table (neutral). */
export interface MetricRow {
  deviceKind: DeviceKind;
  deviceId: string;
  kind: MetricKind;
  value: number | null;
  valueText: string | null;
  sampledAt: Date;
}

/** Metric series grouped per device, ready for the detectors. */
export interface SeriesByDevice {
  deviceKind: DeviceKind;
  deviceId: string;
  rxPower: Array<{ t: number; v: number }>;
  txPower: Array<{ t: number; v: number }>;
  temperature: Array<{ t: number; v: number }>;
  uptime: Array<{ t: number; uptimeSeconds: number }>;
  statuses: Array<{ t: number; status: DeviceStatus }>;
}

/** A deduplicated, persistent proactive alert. */
export interface AlertRecord {
  id?: string;
  tenantId: string;
  connectionId: string | null;
  kind: FindingKind;
  severity: 'warning' | 'critical';
  deviceKind: DeviceKind;
  deviceId: string;
  title: string;
  description: string;
  etaMs?: number | null;
  confidence?: number | null;
  status: AlertStatus;
  firstSeenAt: Date;
  lastSeenAt: Date;
  lastNotifiedAt: Date | null;
  resolvedAt?: Date | null;
}

/** A correlated incident grouping multiple active alerts on one device. */
export interface IncidentRecord {
  id?: string;
  tenantId: string;
  connectionId: string | null;
  deviceKind: DeviceKind;
  deviceId: string;
  title: string;
  description: string;
  severity: 'warning' | 'critical';
  status: AlertStatus;
  firstSeenAt: Date;
  lastSeenAt: Date;
  resolvedAt?: Date | null;
}
