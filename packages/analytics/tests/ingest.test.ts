import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  createMany: vi.fn(),
  deleteMany: vi.fn(),
}));

vi.mock('@ftth-copilot/db', () => ({
  prisma: {
    metricSample: {
      createMany: mocks.createMany,
      deleteMany: mocks.deleteMany,
    },
  },
}));

import { persistSamples, deleteSamplesBefore } from '../src/ingest';
import { runRetention } from '../src/retention';
import type { MetricPoint } from '../src/types';

const SAMPLED_AT = '2026-08-21T00:00:00.000Z';

function point(overrides: Partial<MetricPoint> = {}): MetricPoint {
  return {
    tenantId: 't1',
    connectionId: 'c1',
    deviceKind: 'ONU',
    deviceId: 'onu-1',
    kind: 'RX_POWER_DBM',
    value: -24.5,
    sampledAt: SAMPLED_AT,
    ...overrides,
  };
}

beforeEach(() => {
  mocks.createMany.mockReset();
  mocks.deleteMany.mockReset();
});

describe('persistSamples', () => {
  it('is a no-op for an empty batch', async () => {
    const result = await persistSamples([]);
    expect(result).toEqual({ inserted: 0 });
    expect(mocks.createMany).not.toHaveBeenCalled();
  });

  it('maps points to rows and inserts them in a single batch', async () => {
    mocks.createMany.mockResolvedValue({ count: 2 });

    const result = await persistSamples([
      point({ deviceId: 'onu-1', kind: 'RX_POWER_DBM', value: -24.5 }),
      point({ deviceId: 'onu-2', kind: 'STATUS', value: undefined, valueText: 'offline' }),
    ]);

    expect(result).toEqual({ inserted: 2 });
    expect(mocks.createMany).toHaveBeenCalledTimes(1);

    const data = mocks.createMany.mock.calls[0][0].data as Array<Record<string, unknown>>;
    expect(data).toHaveLength(2);
    expect(data[0]).toEqual({
      tenantId: 't1',
      connectionId: 'c1',
      deviceKind: 'ONU',
      deviceId: 'onu-1',
      kind: 'RX_POWER_DBM',
      value: -24.5,
      valueText: null,
      sampledAt: new Date(SAMPLED_AT),
    });
    expect(data[1]).toEqual({
      tenantId: 't1',
      connectionId: 'c1',
      deviceKind: 'ONU',
      deviceId: 'onu-2',
      kind: 'STATUS',
      value: null,
      valueText: 'offline',
      sampledAt: new Date(SAMPLED_AT),
    });
  });

  it('normalizes undefined value and valueText to null', async () => {
    mocks.createMany.mockResolvedValue({ count: 1 });

    await persistSamples([point({ value: undefined, valueText: undefined })]);

    const data = mocks.createMany.mock.calls[0][0].data as Array<Record<string, unknown>>;
    expect(data[0]?.value).toBeNull();
    expect(data[0]?.valueText).toBeNull();
  });
});

describe('deleteSamplesBefore', () => {
  it('deletes samples strictly older than the cutoff', async () => {
    mocks.deleteMany.mockResolvedValue({ count: 5 });
    const cutoff = new Date('2026-08-01T00:00:00.000Z');

    const result = await deleteSamplesBefore(cutoff);

    expect(result).toEqual({ deleted: 5 });
    expect(mocks.deleteMany).toHaveBeenCalledWith({ where: { sampledAt: { lt: cutoff } } });
  });
});

describe('runRetention', () => {
  it('computes the cutoff from retentionDays and now', async () => {
    mocks.deleteMany.mockResolvedValue({ count: 3 });
    const now = new Date('2026-08-21T12:00:00.000Z');

    const result = await runRetention({ retentionDays: 30, now });

    expect(result).toEqual({ deleted: 3 });
    const where = mocks.deleteMany.mock.calls[0][0].where as { sampledAt: { lt: Date } };
    expect(where.sampledAt.lt).toEqual(new Date('2026-07-22T12:00:00.000Z'));
  });

  it('defaults now to the current time', async () => {
    mocks.deleteMany.mockResolvedValue({ count: 0 });
    const before = Date.now();

    await runRetention({ retentionDays: 7 });

    const where = mocks.deleteMany.mock.calls[0][0].where as { sampledAt: { lt: Date } };
    const after = Date.now();
    expect(where.sampledAt.lt.getTime()).toBeGreaterThanOrEqual(before - 7 * 86400000 - 1000);
    expect(where.sampledAt.lt.getTime()).toBeLessThanOrEqual(after - 7 * 86400000 + 1000);
  });
});
