/**
 * Canonical FTTH telemetry domain contracts shared across analytics, alerts,
 * and downstream consumers.
 *
 * `DeviceKind` and `MetricKind` mirror the Prisma enums in `@ftth-copilot/db`
 * (`DeviceKind`, `MetricKind`); an anti-drift test in `@ftth-copilot/analytics`
 * verifies exact parity at runtime and at the type level.
 */

export const DEVICE_KINDS = ['OLT', 'ONU'] as const;
export type DeviceKind = (typeof DEVICE_KINDS)[number];

export const METRIC_KINDS = [
  'RX_POWER_DBM',
  'TX_POWER_DBM',
  'TEMPERATURE_CELSIUS',
  'UPTIME_SECONDS',
  'STATUS',
  'FEC_CORRECTED',
  'FEC_UNCORRECTED',
  'BIAS_CURRENT_MA',
  'ONT_TEMPERATURE_CELSIUS',
  'LOS_SECONDS_TOTAL',
  'TRAFFIC_THROUGHPUT_MBPS',
] as const;
export type MetricKind = (typeof METRIC_KINDS)[number];

export const DEVICE_STATUSES = ['online', 'offline', 'degraded'] as const;
export type DeviceStatus = (typeof DEVICE_STATUSES)[number];

export interface SampleMeta {
  tenantId: string;
  connectionId: string;
}
