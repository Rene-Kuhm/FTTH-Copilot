/**
 * Property-based invariants for `groupRows` (`packages/alerts/src/group.ts`).
 *
 * Seed & bounds:
 *   - SEED = 20260923
 *   - RUNS = 200
 *
 * Refinements confirmed against source (`src/group.ts:9-79`):
 *   - `groupRows` preserves insertion order for devices and input order for per-metric arrays
 *     ("Pure and order-independent (detectors sort by time)"). Order-independence therefore
 *     holds modulo permutation (verified via canonical sorting of the output).
 *   - Dropping null numeric values or unknown STATUS texts means 0 samples are appended to any
 *     metric array (an empty `SeriesByDevice` shell is still initialized for each seen device key).
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { groupRows } from '../../src/group';
import type { DeviceStatus, MetricRow, SeriesByDevice } from '../../src/types';
import { VALID_DEVICE_STATUSES, metricRowArb } from './arbitraries';

const SEED = 20260923;
const RUNS = 200;

function compareNumericSamples(a: { t: number; v: number }, b: { t: number; v: number }): number {
  return a.t - b.t || a.v - b.v;
}

function compareUptimeSamples(
  a: { t: number; uptimeSeconds: number },
  b: { t: number; uptimeSeconds: number },
): number {
  return a.t - b.t || a.uptimeSeconds - b.uptimeSeconds;
}

function compareStatusSamples(
  a: { t: number; status: DeviceStatus },
  b: { t: number; status: DeviceStatus },
): number {
  return a.t - b.t || a.status.localeCompare(b.status);
}

function canonicalize(seriesList: SeriesByDevice[]): SeriesByDevice[] {
  return [...seriesList]
    .sort((a, b) => `${a.deviceKind}:${a.deviceId}`.localeCompare(`${b.deviceKind}:${b.deviceId}`))
    .map((s) => ({
      deviceKind: s.deviceKind,
      deviceId: s.deviceId,
      rxPower: [...s.rxPower].sort(compareNumericSamples),
      txPower: [...s.txPower].sort(compareNumericSamples),
      temperature: [...s.temperature].sort(compareNumericSamples),
      uptime: [...s.uptime].sort(compareUptimeSamples),
      statuses: [...s.statuses].sort(compareStatusSamples),
      fecCorrected: [...s.fecCorrected].sort(compareNumericSamples),
      fecUncorrected: [...s.fecUncorrected].sort(compareNumericSamples),
      biasCurrent: [...s.biasCurrent].sort(compareNumericSamples),
      ontTemperature: [...s.ontTemperature].sort(compareNumericSamples),
      losSecondsTotal: [...s.losSecondsTotal].sort(compareNumericSamples),
      traffic: [...s.traffic].sort(compareNumericSamples),
    }));
}

function isDroppedRow(row: MetricRow): boolean {
  if (row.kind === 'STATUS') {
    return (
      row.valueText === null || !VALID_DEVICE_STATUSES.includes(row.valueText as DeviceStatus)
    );
  }
  return row.value === null;
}

function totalSeriesSamples(s: SeriesByDevice): number {
  return (
    s.rxPower.length +
    s.txPower.length +
    s.temperature.length +
    s.uptime.length +
    s.statuses.length +
    s.fecCorrected.length +
    s.fecUncorrected.length +
    s.biasCurrent.length +
    s.ontTemperature.length +
    s.losSecondsTotal.length +
    s.traffic.length
  );
}

describe('groupRows property-based invariants', () => {
  it('A-6 (order-independence): groupRows produces identical canonical per-device series regardless of row order', () => {
    const rowsWithPermutationArb = fc
      .array(metricRowArb, { minLength: 0, maxLength: 40 })
      .chain((rows) =>
        fc.tuple(
          fc.constant(rows),
          fc.shuffledSubarray(rows, { minLength: rows.length, maxLength: rows.length }),
        ),
      );

    fc.assert(
      fc.property(rowsWithPermutationArb, ([rows, permuted]) => {
        expect(canonicalize(groupRows(permuted))).toEqual(canonicalize(groupRows(rows)));
      }),
      { seed: SEED, numRuns: RUNS },
    );
  });

  it('A-6 (drops null and unknown statuses): null numeric values and unknown status texts emit zero samples', () => {
    fc.assert(
      fc.property(fc.array(metricRowArb, { minLength: 0, maxLength: 40 }), (rows) => {
        const grouped = groupRows(rows);
        const keptRows = rows.filter((r) => !isDroppedRow(r));

        const totalGroupedSamples = grouped.reduce((sum, s) => sum + totalSeriesSamples(s), 0);
        expect(totalGroupedSamples).toBe(keptRows.length);

        const droppedOnly = rows.filter((r) => isDroppedRow(r));
        for (const s of groupRows(droppedOnly)) {
          expect(totalSeriesSamples(s)).toBe(0);
        }
      }),
      { seed: SEED, numRuns: RUNS },
    );
  });

  it('A-6 (device-key isolation): groupRows emits one series per distinct device key and never mixes two device keys in one series', () => {
    fc.assert(
      fc.property(fc.array(metricRowArb, { minLength: 0, maxLength: 40 }), (rows) => {
        const grouped = groupRows(rows);
        const distinctKeys = new Set(rows.map((r) => `${r.deviceKind}:${r.deviceId}`));

        expect(grouped).toHaveLength(distinctKeys.size);
        expect(new Set(grouped.map((s) => `${s.deviceKind}:${s.deviceId}`))).toEqual(distinctKeys);

        for (const series of grouped) {
          const ownRows = rows.filter(
            (r) => r.deviceKind === series.deviceKind && r.deviceId === series.deviceId,
          );
          expect(canonicalize([series])).toEqual(canonicalize(groupRows(ownRows)));
        }
      }),
      { seed: SEED, numRuns: RUNS },
    );
  });
});
