import { describe, expect, it } from 'vitest';
import { buildNocDegradationScenario } from '../src/scenario';

const META = { tenantId: 't1', connectionId: 'c1' };
const NOW = new Date('2026-08-30T12:00:00.000Z');

describe('buildNocDegradationScenario', () => {
  it('emits four metric kinds per ONU sample', () => {
    const points = buildNocDegradationScenario(META, { now: NOW, samples: 12 });
    expect(points).toHaveLength(12 * 4);
    const kinds = new Set(points.map((p) => p.kind));
    expect(kinds).toEqual(new Set(['RX_POWER_DBM', 'FEC_CORRECTED', 'FEC_UNCORRECTED', 'BIAS_CURRENT_MA']));
  });

  it('drives RX power monotonically downward toward the offline threshold', () => {
    const rx = buildNocDegradationScenario(META, { now: NOW, samples: 12 })
      .filter((p) => p.kind === 'RX_POWER_DBM')
      .map((p) => p.value as number);
    expect(rx[0]).toBeGreaterThan(rx[rx.length - 1]!);
    expect(rx[rx.length - 1]).toBeLessThanOrEqual(-27);
  });

  it('grows FEC corrected counters and introduces uncorrectable codewords late', () => {
    const fec = buildNocDegradationScenario(META, { now: NOW, samples: 12 });
    const corrected = fec.filter((p) => p.kind === 'FEC_CORRECTED').map((p) => p.value as number);
    const uncorrected = fec.filter((p) => p.kind === 'FEC_UNCORRECTED').map((p) => p.value as number);
    expect(corrected[corrected.length - 1]).toBeGreaterThan(corrected[0]!);
    expect(uncorrected[0]).toBe(0);
    expect(uncorrected[uncorrected.length - 1]).toBeGreaterThan(0);
  });

  it('sags bias current below the healthy band at the end', () => {
    const bias = buildNocDegradationScenario(META, { now: NOW, samples: 12 })
      .filter((p) => p.kind === 'BIAS_CURRENT_MA')
      .map((p) => p.value as number);
    expect(bias[bias.length - 1]).toBeLessThan(2);
  });
});
