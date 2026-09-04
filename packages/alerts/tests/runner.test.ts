import { describe, it, expect } from 'vitest';
import { runDetectors } from '../src/runner';
import type { SeriesByDevice } from '../src/types';

const NOW = 1_752_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

function makeSeries(overrides: Partial<SeriesByDevice> = {}): SeriesByDevice {
  return {
    deviceKind: 'ONU',
    deviceId: 'onu-1',
    rxPower: [],
    txPower: [],
    temperature: [],
    uptime: [],
    statuses: [],
    fecCorrected: [],
    fecUncorrected: [],
    biasCurrent: [],
    ontTemperature: [],
    traffic: [],
    ...overrides,
  };
}

describe('runDetectors', () => {
  it('returns an empty array for no series', () => {
    expect(runDetectors([])).toEqual([]);
  });

  it('returns an empty array when series have no meaningful data', () => {
    expect(runDetectors([makeSeries()])).toEqual([]);
  });

  it('detects signal drift from descending rxPower', () => {
    const series = makeSeries({
      rxPower: [-22, -23, -24, -25, -26].map((v, i) => ({ t: NOW - (4 - i) * DAY, v })),
    });
    const findings = runDetectors([series], { now: NOW });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.kind).toBe('predicted_low_signal');
  });

  it('detects flapping from oscillating statuses', () => {
    const statuses = (['online', 'offline', 'online', 'offline'] as const).map((status, i) => ({
      t: NOW - (3 - i) * HOUR,
      status,
    }));
    const findings = runDetectors([makeSeries({ statuses })], { now: NOW });
    expect(findings.some((f) => f.kind === 'intermittent_connection')).toBe(true);
  });

  it('detects temperature drift from rising temperature', () => {
    const series = makeSeries({
      deviceKind: 'OLT',
      deviceId: 'olt-1',
      temperature: [50, 52, 54, 56, 58].map((v, i) => ({ t: NOW - (4 - i) * DAY, v })),
    });
    const findings = runDetectors([series], { now: NOW });
    expect(findings.some((f) => f.kind === 'predicted_high_temperature')).toBe(true);
  });

  it('detects FEC degradation from rising uncorrectable codewords', () => {
    const series = makeSeries({
      fecCorrected: [0, 10, 20, 30].map((v, i) => ({ t: NOW - (3 - i) * DAY, v })),
      fecUncorrected: [0, 0, 0, 5].map((v, i) => ({ t: NOW - (3 - i) * DAY, v })),
    });
    const findings = runDetectors([series], { now: NOW });
    expect(findings.some((f) => f.kind === 'fec_degradation')).toBe(true);
  });
});
