import fc from 'fast-check';
import type { Finding, FindingKind, Severity } from '@ftth-copilot/detection';
import type {
  AlertRecord,
  AlertStatus,
  DeviceKind,
  DeviceStatus,
  MetricKind,
  MetricRow,
} from '../../src/types';

export const NOW = new Date('2026-08-21T00:00:00.000Z');
export const DAY_MS = 24 * 60 * 60 * 1000;

export const TENANT_IDS = ['tenant-a', 'tenant-b'] as const;
export const CONNECTION_IDS = ['conn-1', 'conn-2', null] as const;
export const DEVICE_KINDS: readonly DeviceKind[] = ['OLT', 'ONU'];
export const SEVERITIES: readonly Severity[] = ['warning', 'critical'];
export const ALERT_STATUSES: readonly AlertStatus[] = ['open', 'acknowledged', 'resolved'];

export const FINDING_KINDS: readonly FindingKind[] = [
  'predicted_low_signal',
  'predicted_high_temperature',
  'intermittent_connection',
  'frequent_reboots',
  'metric_anomaly',
  'fec_degradation',
  'optical_degradation',
  'traffic_anomaly',
];

export const VALID_DEVICE_STATUSES: readonly DeviceStatus[] = ['online', 'offline', 'degraded'];

export const NUMERIC_METRIC_KINDS: readonly MetricKind[] = [
  'RX_POWER_DBM',
  'TX_POWER_DBM',
  'TEMPERATURE_CELSIUS',
  'UPTIME_SECONDS',
  'FEC_CORRECTED',
  'FEC_UNCORRECTED',
  'BIAS_CURRENT_MA',
  'ONT_TEMPERATURE_CELSIUS',
  'LOS_SECONDS_TOTAL',
  'TRAFFIC_THROUGHPUT_MBPS',
];

export const ALL_METRIC_KINDS: readonly MetricKind[] = [...NUMERIC_METRIC_KINDS, 'STATUS'];

export const tenantIdArb: fc.Arbitrary<string> = fc.constantFrom(...TENANT_IDS);
export const connectionIdArb: fc.Arbitrary<string | null> = fc.constantFrom(...CONNECTION_IDS);
export const deviceKindArb: fc.Arbitrary<DeviceKind> = fc.constantFrom(...DEVICE_KINDS);
export const deviceIdArb: fc.Arbitrary<string> = fc.constantFrom(
  'onu-1',
  'onu-2',
  'onu-3',
  'olt-1',
  'olt-2',
);
export const severityArb: fc.Arbitrary<Severity> = fc.constantFrom(...SEVERITIES);
export const alertStatusArb: fc.Arbitrary<AlertStatus> = fc.constantFrom(...ALERT_STATUSES);
export const findingKindArb: fc.Arbitrary<FindingKind> = fc.constantFrom(...FINDING_KINDS);

export interface AlertArbitraryOptions {
  tenantId?: fc.Arbitrary<string>;
  connectionId?: fc.Arbitrary<string | null>;
  deviceKind?: fc.Arbitrary<DeviceKind>;
  deviceId?: fc.Arbitrary<string>;
  kind?: fc.Arbitrary<FindingKind>;
  severity?: fc.Arbitrary<Severity>;
  status?: fc.Arbitrary<AlertStatus>;
}

export function alertRecordArb(opts: AlertArbitraryOptions = {}): fc.Arbitrary<AlertRecord> {
  return fc
    .record({
      tenantId: opts.tenantId ?? tenantIdArb,
      connectionId: opts.connectionId ?? connectionIdArb,
      kind: opts.kind ?? findingKindArb,
      severity: opts.severity ?? severityArb,
      deviceKind: opts.deviceKind ?? deviceKindArb,
      deviceId: opts.deviceId ?? deviceIdArb,
      status: opts.status ?? alertStatusArb,
      startOffsetMs: fc.integer({ min: -30 * DAY_MS, max: 0 }),
      durationMs: fc.integer({ min: 0, max: 30 * DAY_MS }),
      notified: fc.boolean(),
    })
    .map((r) => {
      const firstSeenAt = new Date(NOW.getTime() + r.startOffsetMs);
      const lastSeenAt = new Date(NOW.getTime() + r.startOffsetMs + r.durationMs);
      return {
        tenantId: r.tenantId,
        connectionId: r.connectionId,
        kind: r.kind,
        severity: r.severity,
        deviceKind: r.deviceKind,
        deviceId: r.deviceId,
        title: `Alert ${r.kind} on ${r.deviceKind}:${r.deviceId}`,
        description: `Synthetic alert for ${r.tenantId}`,
        status: r.status,
        firstSeenAt,
        lastSeenAt,
        lastNotifiedAt: r.notified ? lastSeenAt : null,
        resolvedAt: r.status === 'resolved' ? lastSeenAt : null,
      };
    });
}

export function findingArb(opts: {
  kind?: fc.Arbitrary<FindingKind>;
  deviceKind?: fc.Arbitrary<DeviceKind>;
  deviceId?: fc.Arbitrary<string>;
} = {}): fc.Arbitrary<Finding> {
  return fc
    .record({
      kind: opts.kind ?? findingKindArb,
      severity: severityArb,
      deviceKind: opts.deviceKind ?? deviceKindArb,
      deviceId: opts.deviceId ?? deviceIdArb,
      etaMs: fc.option(fc.integer({ min: 0, max: 30 * DAY_MS }), { nil: undefined }),
      confidence: fc.option(
        fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }).map((v) =>
          Object.is(v, -0) ? 0 : v,
        ),
        { nil: undefined },
      ),
    })
    .map((f) => ({
      id: `${f.kind}-${f.deviceKind}-${f.deviceId}`,
      kind: f.kind,
      severity: f.severity,
      deviceKind: f.deviceKind,
      deviceId: f.deviceId,
      title: `Finding ${f.kind} on ${f.deviceKind}:${f.deviceId}`,
      description: 'Synthetic finding',
      etaMs: f.etaMs,
      confidence: f.confidence,
      detectedAt: NOW.toISOString(),
    }));
}

const finiteMetricValueArb: fc.Arbitrary<number> = fc
  .double({ min: -100, max: 100000, noNaN: true, noDefaultInfinity: true })
  .map((v) => (Object.is(v, -0) ? 0 : v));

const unknownStatusTextArb: fc.Arbitrary<string | null> = fc.constantFrom(
  null,
  '',
  'unknown',
  'booting',
  'ONLINE',
  'toString',
  'constructor',
);

export const metricRowArb: fc.Arbitrary<MetricRow> = fc
  .record({
    deviceKind: deviceKindArb,
    deviceId: deviceIdArb,
    kind: fc.constantFrom(...ALL_METRIC_KINDS),
    numericValue: fc.option(finiteMetricValueArb, { nil: null }),
    statusText: fc.oneof(fc.constantFrom(...VALID_DEVICE_STATUSES), unknownStatusTextArb),
    offsetMs: fc.integer({ min: -14 * DAY_MS, max: 14 * DAY_MS }),
  })
  .map((r) => ({
    deviceKind: r.deviceKind,
    deviceId: r.deviceId,
    kind: r.kind,
    value: r.kind === 'STATUS' ? null : r.numericValue,
    valueText: r.kind === 'STATUS' ? r.statusText : null,
    sampledAt: new Date(NOW.getTime() + r.offsetMs),
  }));
