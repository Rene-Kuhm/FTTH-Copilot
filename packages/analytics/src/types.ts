/**
 * Neutral (DB-agnostic) types for time-series metrics ingestion.
 * Kept independent from Prisma so the collector can be unit-tested without a
 * database; `ingest.ts` maps these to the generated Prisma enums.
 */

export type DeviceKind = 'OLT' | 'ONU';

export type MetricKind =
  | 'RX_POWER_DBM'
  | 'TX_POWER_DBM'
  | 'TEMPERATURE_CELSIUS'
  | 'UPTIME_SECONDS'
  | 'STATUS'
  | 'FEC_CORRECTED'
  | 'FEC_UNCORRECTED'
  | 'BIAS_CURRENT_MA'
  | 'ONT_TEMPERATURE_CELSIUS'
  | 'LOS_SECONDS_TOTAL'
  | 'TRAFFIC_THROUGHPUT_MBPS';

export type DeviceStatus = 'online' | 'offline' | 'degraded';

export interface MetricPoint {
  tenantId: string;
  connectionId: string;
  deviceKind: DeviceKind;
  deviceId: string;
  kind: MetricKind;
  /** Numeric value for non-STATUS metrics. */
  value?: number;
  /** Text value for the STATUS metric (online/offline/degraded). */
  valueText?: string;
  /** ISO-8601 timestamp of when the sample was taken. */
  sampledAt: string;
}

export interface SampleMeta {
  tenantId: string;
  connectionId: string;
}

export interface CollectOptions {
  /** Fixed sample time (defaults to now). Used for deterministic tests. */
  now?: Date;
  /**
   * Whether to fan out to getOltDetail() per OLT to capture temperature and
   * uptime. Expensive under SmartOLT's rate limit (15 req/hour), so it defaults
   * to false and falls back to whatever `listOlts()` already provides.
   */
  includeOltDetail?: boolean;
  /**
   * Whether to fan out to getOnuDetail() per ONU so the optical-health fields
   * (FEC corrected/uncorrected, bias current, ONT temperature) and the
   * firmware version reach the metrics table. Costs N extra requests per
   * poll cycle, so it defaults to false; the connector must also opt-in via
   * `includeOnuDetail` for the fan-out to actually fire.
   */
  includeOnuDetail?: boolean;
}
