import { describe, expect, it } from 'vitest';
import * as Shared from '../src/index';

describe('shared canonical domain contracts', () => {
  it('exports DEVICE_KINDS with the canonical device kind members', () => {
    expect(Shared.DEVICE_KINDS).toEqual(['OLT', 'ONU']);
  });

  it('exports METRIC_KINDS with all 11 canonical metric kind members', () => {
    expect(Shared.METRIC_KINDS).toEqual([
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
    ]);
  });

  it('exports DEVICE_STATUSES with the canonical device status members', () => {
    expect(Shared.DEVICE_STATUSES).toEqual(['online', 'offline', 'degraded']);
  });

  it('exposes DeviceKind, MetricKind, DeviceStatus, and SampleMeta types at the boundary', () => {
    const kind: Shared.DeviceKind = 'ONU';
    const metric: Shared.MetricKind = 'RX_POWER_DBM';
    const status: Shared.DeviceStatus = 'online';
    const meta: Shared.SampleMeta = { tenantId: 'tenant-1', connectionId: 'conn-1' };

    expect(kind).toBe('ONU');
    expect(metric).toBe('RX_POWER_DBM');
    expect(status).toBe('online');
    expect(meta).toEqual({ tenantId: 'tenant-1', connectionId: 'conn-1' });
  });
});
