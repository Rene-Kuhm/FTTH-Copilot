import { describe, it, expect } from 'vitest';
import type { OnuDetail, OnuSummary } from '@ftth-copilot/connectors-core';
import {
  pickFecFanOutSlice,
  fitsRateBudget,
  assembleOnuDetailPoints,
  mapAllSettled,
} from '../src/scheduler-helpers';

const META = { tenantId: 'tenant-A', connectionId: 'conn-1' };
const ISO = '2026-08-21T00:00:00.000Z';

function makeOnu(id: string, status: OnuSummary['status'] = 'online'): OnuSummary {
  return { id, serial: `SN-${id}`, oltId: 'OLT-1', status };
}

function makeOnus(ids: string[]): OnuSummary[] {
  return ids.map((id) => makeOnu(id));
}

describe('pickFecFanOutSlice', () => {
  it('returns an empty slice for an empty input', () => {
    const slice = pickFecFanOutSlice([], 0, 8);
    expect(slice).toEqual([]);
  });

  it('returns the full sorted input when sliceSize is greater than or equal to the input length', () => {
    const onus = makeOnus(['ONU-3', 'ONU-1', 'ONU-2', 'ONU-5', 'ONU-4']);
    const slice = pickFecFanOutSlice(onus, 0, 8);
    expect(slice.map((o) => o.id)).toEqual(['ONU-1', 'ONU-2', 'ONU-3', 'ONU-4', 'ONU-5']);
    expect(slice).toHaveLength(5);
  });

  it('returns an empty slice when sliceSize is zero', () => {
    const onus = makeOnus(['ONU-1', 'ONU-2', 'ONU-3']);
    const slice = pickFecFanOutSlice(onus, 0, 0);
    expect(slice).toEqual([]);
  });

  it('returns a single ONU when sliceSize is one', () => {
    const onus = makeOnus(['ONU-2', 'ONU-1']);
    const slice = pickFecFanOutSlice(onus, 0, 1);
    expect(slice).toHaveLength(1);
    expect(slice[0]?.id).toBe('ONU-1');
  });

  it('returns disjoint slices for consecutive tickIndex values when input is exactly twice the slice size', () => {
    const onus = makeOnus(
      Array.from({ length: 16 }, (_, i) => `ONU-${String(i + 1).padStart(2, '0')}`),
    );
    const sortedIds = onus.map((o) => o.id).sort();
    const slice0 = pickFecFanOutSlice(onus, 0, 8).map((o) => o.id);
    const slice1 = pickFecFanOutSlice(onus, 1, 8).map((o) => o.id);
    expect(slice0).toEqual(sortedIds.slice(0, 8));
    expect(slice1).toEqual(sortedIds.slice(8, 16));
    expect(slice0).toHaveLength(8);
    expect(slice1).toHaveLength(8);
    expect(new Set([...slice0, ...slice1]).size).toBe(16);
  });

  it('wraps the start index modulo the input length when tickIndex advances past one full pass', () => {
    const onus = makeOnus(['ONU-1', 'ONU-2', 'ONU-3']);
    const slice0 = pickFecFanOutSlice(onus, 0, 2).map((o) => o.id);
    const slice1 = pickFecFanOutSlice(onus, 1, 2).map((o) => o.id);
    const slice2 = pickFecFanOutSlice(onus, 2, 2).map((o) => o.id);
    // sorted input is ['ONU-1','ONU-2','ONU-3']
    expect(slice0).toEqual(['ONU-1', 'ONU-2']);
    expect(slice1).toEqual(['ONU-3', 'ONU-1']);
    expect(slice2).toEqual(['ONU-2', 'ONU-3']);
  });

  it('does not mutate the input array (deep-equal)', () => {
    const onus = makeOnus(['ONU-3', 'ONU-1', 'ONU-2']);
    const snapshot = JSON.parse(JSON.stringify(onus)) as OnuSummary[];
    pickFecFanOutSlice(onus, 0, 2);
    expect(onus).toEqual(snapshot);
  });

  it('does not mutate a frozen input array', () => {
    const onus = Object.freeze(makeOnus(['ONU-3', 'ONU-1', 'ONU-2']));
    expect(() => pickFecFanOutSlice(onus, 0, 2)).not.toThrow();
  });

  it('clamps the slice length to the input length when sliceSize exceeds input', () => {
    const onus = makeOnus(['ONU-1', 'ONU-2']);
    const slice = pickFecFanOutSlice(onus, 0, 100);
    expect(slice).toHaveLength(2);
  });
});

describe('fitsRateBudget', () => {
  it('passes for the default cadence (8 per cycle, hourly interval, 15 req/h budget)', () => {
    expect(fitsRateBudget(8, 3_600_000, 15)).toBe(true);
  });

  it('fails when the projected per-hour rate exceeds the budget', () => {
    expect(fitsRateBudget(32, 3_600_000, 15)).toBe(false);
  });

  it('passes when the projected per-hour rate equals the budget (inclusive upper bound)', () => {
    expect(fitsRateBudget(15, 3_600_000, 15)).toBe(true);
  });

  it('passes for perCycle=0 (vacuous: zero requests per hour)', () => {
    expect(fitsRateBudget(0, 3_600_000, 15)).toBe(true);
  });

  it('passes for negative perCycle (treated as zero requests per hour)', () => {
    expect(fitsRateBudget(-3, 3_600_000, 15)).toBe(true);
  });

  it('fails for non-positive intervalMs (would divide by zero or invert the budget)', () => {
    expect(fitsRateBudget(8, 0, 15)).toBe(false);
    expect(fitsRateBudget(8, -1, 15)).toBe(false);
  });

  it('fails for NaN intervalMs', () => {
    expect(fitsRateBudget(8, Number.NaN, 15)).toBe(false);
  });

  it('scales with shorter intervals (faster cadence consumes budget faster)', () => {
    // 8 per cycle × 60 cycles/hour (60_000ms interval) = 480/hour → exceeds 15.
    expect(fitsRateBudget(8, 60_000, 15)).toBe(false);
    // 1 per cycle × 60 cycles/hour = 60/hour → still exceeds 15.
    expect(fitsRateBudget(1, 60_000, 15)).toBe(false);
    // 1 per cycle × 1 cycle/hour (3,600,000ms) = 1/hour → passes.
    expect(fitsRateBudget(1, 3_600_000, 15)).toBe(true);
  });
});

describe('assembleOnuDetailPoints', () => {
  it('emits four FEC/optical points for a SmartOLT-shaped detail with all four fields populated', () => {
    const detail: OnuDetail = {
      ...makeOnu('ONU-1'),
      fecCorrected: 1234,
      fecUncorrected: 7,
      biasCurrentMa: 18.4,
      ontTemperatureCelsius: 52,
    };
    const points = assembleOnuDetailPoints(META, detail, ISO);

    expect(points).toEqual([
      { ...META, deviceKind: 'ONU', deviceId: 'ONU-1', kind: 'FEC_CORRECTED', value: 1234, sampledAt: ISO },
      { ...META, deviceKind: 'ONU', deviceId: 'ONU-1', kind: 'FEC_UNCORRECTED', value: 7, sampledAt: ISO },
      { ...META, deviceKind: 'ONU', deviceId: 'ONU-1', kind: 'BIAS_CURRENT_MA', value: 18.4, sampledAt: ISO },
      { ...META, deviceKind: 'ONU', deviceId: 'ONU-1', kind: 'ONT_TEMPERATURE_CELSIUS', value: 52, sampledAt: ISO },
    ]);
  });

  it('emits an empty array for a Mikrowisp-shaped detail with no fec/bias/ontTemp fields', () => {
    // Mikrowisp detail: just id/serial/oltId/status — no optical telemetry.
    const detail: OnuDetail = makeOnu('ONU-9', 'offline');
    const points = assembleOnuDetailPoints(META, detail, ISO);
    expect(points).toEqual([]);
  });

  it('emits only the finite fields, skipping undefined and non-finite values', () => {
    const detail: OnuDetail = {
      ...makeOnu('ONU-2'),
      fecCorrected: Number.NaN,
      fecUncorrected: 5,
      biasCurrentMa: undefined,
      ontTemperatureCelsius: Number.POSITIVE_INFINITY,
    };
    const points = assembleOnuDetailPoints(META, detail, ISO);

    expect(points).toEqual([
      { ...META, deviceKind: 'ONU', deviceId: 'ONU-2', kind: 'FEC_UNCORRECTED', value: 5, sampledAt: ISO },
    ]);
  });

  it('emits only the finite fields when a single field is finite and the rest are undefined', () => {
    const detail: OnuDetail = { ...makeOnu('ONU-3'), fecCorrected: 100 };
    const points = assembleOnuDetailPoints(META, detail, ISO);
    expect(points).toEqual([
      { ...META, deviceKind: 'ONU', deviceId: 'ONU-3', kind: 'FEC_CORRECTED', value: 100, sampledAt: ISO },
    ]);
  });

  it('does not emit STATUS, RX/TX power, or uptime (those are collected via the bulk listOnus path)', () => {
    const detail: OnuDetail = {
      ...makeOnu('ONU-4'),
      rxPowerDbm: -23.1,
      txPowerDbm: 1.7,
      uptimeSeconds: 3600,
    };
    const points = assembleOnuDetailPoints(META, detail, ISO);
    expect(points).toEqual([]);
  });

  it('keeps every emitted point stamped with the provided sampledAt timestamp', () => {
    const detail: OnuDetail = { ...makeOnu('ONU-7'), fecCorrected: 5, biasCurrentMa: 11.2 };
    const customTs = '2025-01-01T12:34:56.789Z';
    const points = assembleOnuDetailPoints(META, detail, customTs);

    expect(points.length).toBeGreaterThan(0);
    for (const p of points) {
      expect(p.sampledAt).toBe(customTs);
    }
  });

  it('attaches meta (tenantId + connectionId) to every emitted point', () => {
    const customMeta = { tenantId: 'tenant-Z', connectionId: 'conn-99' };
    const detail: OnuDetail = { ...makeOnu('ONU-8'), fecCorrected: 42 };
    const points = assembleOnuDetailPoints(customMeta, detail, ISO);

    expect(points.length).toBeGreaterThan(0);
    for (const p of points) {
      expect(p.tenantId).toBe('tenant-Z');
      expect(p.connectionId).toBe('conn-99');
    }
  });
});

describe('mapAllSettled', () => {
  it('returns an empty array for empty input', async () => {
    const out = await mapAllSettled<number, number>([], 4, async (n) => n * 2);
    expect(out).toEqual([]);
  });

  it('preserves the input order in the output', async () => {
    const items = [3, 1, 4, 1, 5, 9, 2, 6];
    const out = await mapAllSettled(items, 4, async (n) => n * 10);
    expect(out).toEqual(
      items.map((n) => ({ ok: true, value: n * 10 })),
    );
  });

  it('captures per-item rejections and lets the rest complete', async () => {
    const items = [1, 2, 3, 4];
    const out = await mapAllSettled(items, 4, async (n) => {
      if (n === 2) throw new Error(`boom-${n}`);
      return n + 100;
    });
    expect(out[0]).toEqual({ ok: true, value: 101 });
    expect(out[1]).toEqual({ ok: false, reason: expect.objectContaining({ message: 'boom-2' }) });
    expect(out[2]).toEqual({ ok: true, value: 103 });
    expect(out[3]).toEqual({ ok: true, value: 104 });
  });

  it('caps concurrency at the requested worker count', async () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    let inFlight = 0;
    let peakInFlight = 0;
    const out = await mapAllSettled(items, 3, async (n) => {
      inFlight += 1;
      peakInFlight = Math.max(peakInFlight, inFlight);
      // Yield to the event loop so the next worker can start.
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return n;
    });
    expect(peakInFlight).toBeLessThanOrEqual(3);
    expect(out.every((r) => r.ok)).toBe(true);
    expect(out).toHaveLength(20);
  });

  it('treats concurrency below 1 as 1 (still runs)', async () => {
    const items = [1, 2, 3];
    const out = await mapAllSettled(items, 0, async (n) => n);
    expect(out).toEqual([
      { ok: true, value: 1 },
      { ok: true, value: 2 },
      { ok: true, value: 3 },
    ]);
  });
});