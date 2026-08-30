import { describe, it, expect } from 'vitest';
import { detectBaselineAnomaly } from '../src/anomaly';
import type { NumericSample } from '../src/types';

const NOW = 1_752_000_000_000;
const HOUR = 60 * 60 * 1000;

// Median = -22, MAD = 0.5 (verified by construction).
const BASELINE = [-22, -22.5, -21.5, -22, -22.5, -21.5, -22, -22.5, -21.5, -22];

function seriesWithLast(values: number[], last: number): NumericSample[] {
  const pts = values.map((v, i) => ({ t: NOW - (values.length - i) * HOUR, v }));
  pts.push({ t: NOW, v: last });
  return pts;
}

describe('detectBaselineAnomaly', () => {
  it('returns null with too few samples', () => {
    const s = [-22, -22.5, -21.5].map((v, i) => ({ t: NOW - (3 - i) * HOUR, v }));
    expect(detectBaselineAnomaly('ONU', 'onu-1', s, { now: NOW })).toBeNull();
  });

  it('returns null for a flat series (no reference variability)', () => {
    const s = Array.from({ length: 10 }, (_, i) => ({ t: NOW - (10 - i) * HOUR, v: -22 }));
    expect(detectBaselineAnomaly('ONU', 'onu-1', s, { now: NOW })).toBeNull();
  });

  it('returns null when the latest sample is in line with the baseline', () => {
    expect(detectBaselineAnomaly('ONU', 'onu-1', seriesWithLast(BASELINE, -22), { now: NOW })).toBeNull();
  });

  it('flags a clear outlier', () => {
    const f = detectBaselineAnomaly('ONU', 'onu-1', seriesWithLast(BASELINE, -30), { now: NOW });
    expect(f).not.toBeNull();
    expect(f!.kind).toBe('metric_anomaly');
    expect(f!.id).toBe('metric-anomaly-ONU-onu-1');
    expect(f!.deviceId).toBe('onu-1');
    expect(['warning', 'critical']).toContain(f!.severity);
    expect(f!.confidence).toBeGreaterThan(0);
    expect(f!.confidence).toBeLessThanOrEqual(1);
  });

  it('uses warning severity for a moderate outlier', () => {
    const f = detectBaselineAnomaly('ONU', 'onu-1', seriesWithLast(BASELINE, -25), { now: NOW });
    expect(f).not.toBeNull();
    expect(f!.severity).toBe('warning');
  });

  it('raises severity to critical for an extreme outlier', () => {
    const f = detectBaselineAnomaly('ONU', 'onu-1', seriesWithLast(BASELINE, -100), { now: NOW });
    expect(f).not.toBeNull();
    expect(f!.severity).toBe('critical');
  });
});
