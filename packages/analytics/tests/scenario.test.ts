import { describe, expect, it } from 'vitest';
import { buildNocDegradationScenario } from '../src/scenario';
import { runDetectors } from '@ftth-copilot/alerts';
import type { SeriesByDevice } from '@ftth-copilot/alerts';

const META = { tenantId: 't1', connectionId: 'c1' };
const NOW = new Date('2026-08-30T12:00:00.000Z');

function seriesFromPoints(points: ReturnType<typeof buildNocDegradationScenario>): SeriesByDevice[] {
  const t = (s: string) => new Date(s).getTime();
  return [{
    deviceKind: 'ONU',
    deviceId: 'onu-scenario-1',
    rxPower: points.filter((p) => p.kind === 'RX_POWER_DBM').map((p) => ({ t: t(p.sampledAt), v: p.value! })),
    txPower: [],
    temperature: [],
    uptime: [],
    statuses: [],
    fecCorrected: points.filter((p) => p.kind === 'FEC_CORRECTED').map((p) => ({ t: t(p.sampledAt), v: p.value! })),
    fecUncorrected: points.filter((p) => p.kind === 'FEC_UNCORRECTED').map((p) => ({ t: t(p.sampledAt), v: p.value! })),
    biasCurrent: points.filter((p) => p.kind === 'BIAS_CURRENT_MA').map((p) => ({ t: t(p.sampledAt), v: p.value! })),
    ontTemperature: [],
    traffic: [],
  }];
}

describe('buildNocDegradationScenario', () => {
  it('emits four metric kinds per ONU sample', () => {
    const points = buildNocDegradationScenario(META, { now: NOW, samples: 12 });
    expect(points).toHaveLength(12 * 4);
    const kinds = new Set(points.map((p) => p.kind));
    expect(kinds).toEqual(new Set(['RX_POWER_DBM', 'FEC_CORRECTED', 'FEC_UNCORRECTED', 'BIAS_CURRENT_MA']));
  });

  it('drives RX power downward but stays above the offline threshold (for ETA prediction)', () => {
    const rx = buildNocDegradationScenario(META, { now: NOW, samples: 12 })
      .filter((p) => p.kind === 'RX_POWER_DBM')
      .map((p) => p.value as number);
    expect(rx[0]).toBeGreaterThan(rx[rx.length - 1]!);
    expect(rx[rx.length - 1]).toBeGreaterThan(-27); // stays above the offline threshold
    expect(rx[rx.length - 1]).toBeLessThan(-20);   // but still trending down
  });

  it('grows FEC corrected counters and introduces uncorrectable codewords late', () => {
    const fec = buildNocDegradationScenario(META, { now: NOW, samples: 12 });
    const corrected = fec.filter((p) => p.kind === 'FEC_CORRECTED').map((p) => p.value as number);
    const uncorrected = fec.filter((p) => p.kind === 'FEC_UNCORRECTED').map((p) => p.value as number);
    expect(corrected[corrected.length - 1]).toBeGreaterThan(corrected[0]!);
    expect(uncorrected[0]).toBe(0);
    expect(uncorrected[uncorrected.length - 1]).toBeGreaterThan(0);
  });

  it('sags bias current below the healthy band (recent average under 2 mA)', () => {
    const points = buildNocDegradationScenario(META, { now: NOW, samples: 12 });
    const bias = points.filter((p) => p.kind === 'BIAS_CURRENT_MA').map((p) => p.value as number);
    expect(bias[bias.length - 1]).toBeLessThan(2);
    // The 24h recent average (last 5 samples at 6h spacing) must also be under 2.
    const recent = bias.slice(-5);
    const avg = recent.reduce((s, v) => s + v, 0) / recent.length;
    expect(avg).toBeLessThan(2);
  });

  // Contractual test: this is what `pnpm test:scenario` produces end-to-end.
  // If this test fails, the harness script is no longer a faithful smoke test
  // for the detectors (the gap that the technical report flagged).
  it('produces exactly the 3 expected detector findings (contractual smoke)', () => {
    const points = buildNocDegradationScenario(META, { now: NOW, samples: 12 });
    const findings = runDetectors(seriesFromPoints(points), { now: NOW.getTime() });
    const kinds = findings.map((f) => f.kind).sort();
    expect(findings).toHaveLength(3);
    expect(kinds).toEqual(['fec_degradation', 'optical_degradation', 'predicted_low_signal']);
  });
});
