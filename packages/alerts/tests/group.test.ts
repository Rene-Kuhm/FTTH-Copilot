import { describe, it, expect } from 'vitest';
import { groupRows } from '../src/group';
import type { MetricRow } from '../src/types';

const T = new Date('2026-08-21T00:00:00.000Z');

function row(overrides: Partial<MetricRow> = {}): MetricRow {
  return {
    deviceKind: 'ONU',
    deviceId: 'onu-1',
    kind: 'RX_POWER_DBM',
    value: -24,
    valueText: null,
    sampledAt: T,
    ...overrides,
  };
}

describe('groupRows', () => {
  it('groups rows per device and metric', () => {
    const rows = [
      row({ deviceId: 'onu-1', kind: 'RX_POWER_DBM', value: -24 }),
      row({ deviceId: 'onu-1', kind: 'RX_POWER_DBM', value: -25, sampledAt: new Date(T.getTime() + 1000) }),
      row({ deviceId: 'onu-1', kind: 'STATUS', value: null, valueText: 'online' }),
      row({ deviceKind: 'OLT', deviceId: 'olt-1', kind: 'TEMPERATURE_CELSIUS', value: 55 }),
    ];

    const grouped = groupRows(rows);

    expect(grouped).toHaveLength(2);
    const onu = grouped.find((s) => s.deviceId === 'onu-1')!;
    const olt = grouped.find((s) => s.deviceId === 'olt-1')!;
    expect(onu.rxPower).toHaveLength(2);
    expect(onu.statuses).toEqual([{ t: T.getTime(), status: 'online' }]);
    expect(olt.temperature).toEqual([{ t: T.getTime(), v: 55 }]);
  });

  it('skips null numeric values', () => {
    const grouped = groupRows([row({ kind: 'RX_POWER_DBM', value: null })]);
    expect(grouped[0]!.rxPower).toHaveLength(0);
  });

  it('skips unknown statuses', () => {
    const grouped = groupRows([row({ kind: 'STATUS', value: null, valueText: 'bogus' })]);
    expect(grouped[0]!.statuses).toHaveLength(0);
  });

  it('returns an empty array for no rows', () => {
    expect(groupRows([])).toEqual([]);
  });

  it('partitions uptime and txPower into their own series', () => {
    const rows = [
      row({ kind: 'UPTIME_SECONDS', value: 3600 }),
      row({ kind: 'TX_POWER_DBM', value: 2.1 }),
    ];
    const grouped = groupRows(rows);
    expect(grouped[0]!.uptime).toEqual([{ t: T.getTime(), uptimeSeconds: 3600 }]);
    expect(grouped[0]!.txPower).toEqual([{ t: T.getTime(), v: 2.1 }]);
  });

  it('partitions FEC and optical metrics into their own series', () => {
    const rows = [
      row({ kind: 'FEC_CORRECTED', value: 42 }),
      row({ kind: 'FEC_UNCORRECTED', value: 3 }),
      row({ kind: 'BIAS_CURRENT_MA', value: 14.2 }),
      row({ kind: 'ONT_TEMPERATURE_CELSIUS', value: 58 }),
    ];
    const grouped = groupRows(rows);
    expect(grouped[0]!.fecCorrected).toEqual([{ t: T.getTime(), v: 42 }]);
    expect(grouped[0]!.fecUncorrected).toEqual([{ t: T.getTime(), v: 3 }]);
    expect(grouped[0]!.biasCurrent).toEqual([{ t: T.getTime(), v: 14.2 }]);
    expect(grouped[0]!.ontTemperature).toEqual([{ t: T.getTime(), v: 58 }]);
  });
});
