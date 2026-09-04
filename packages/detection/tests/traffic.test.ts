import { describe, expect, it } from 'vitest';
import { detectTrafficAnomaly } from '../src/traffic';

const NOW = 1_752_000_000_000;
const MINUTE = 60 * 1000;

function series(
  values: number[],
  intervalMin = 1,
): Array<{ t: number; v: number }> {
  return values.map((v, i) => ({
    t: NOW - (values.length - 1 - i) * intervalMin * MINUTE,
    v,
  }));
}

describe('detectTrafficAnomaly', () => {
  it('flags sustained high throughput above threshold', () => {
    const finding = detectTrafficAnomaly(
      'ONU',
      'onu-1',
      series([120, 130, 140, 150]),
      { now: NOW },
    );
    expect(finding?.kind).toBe('traffic_anomaly');
    expect(finding?.severity).toBe('warning');
    expect(finding?.deviceId).toBe('onu-1');
  });

  it('returns critical severity at 2x threshold', () => {
    const finding = detectTrafficAnomaly(
      'ONU',
      'onu-1',
      series([250, 300, 350]),
      { now: NOW },
    );
    expect(finding?.severity).toBe('critical');
  });

  it('returns null when average is below threshold', () => {
    const finding = detectTrafficAnomaly(
      'ONU',
      'onu-1',
      series([10, 20, 30, 40]),
      { now: NOW },
    );
    expect(finding).toBeNull();
  });

  it('returns null with fewer samples than minSamples', () => {
    const finding = detectTrafficAnomaly(
      'ONU',
      'onu-1',
      series([150, 160]),
      { now: NOW, minSamples: 3 },
    );
    expect(finding).toBeNull();
  });

  it('filters out-of-window samples', () => {
    // Only 2 samples within the 15-min window; the rest are older.
    const samples = [
      { t: NOW - 20 * MINUTE, v: 500 }, // outside window
      { t: NOW - 10 * MINUTE, v: 150 },
      { t: NOW - 5 * MINUTE, v: 160 },
      { t: NOW, v: 170 },
    ];
    const finding = detectTrafficAnomaly('OLT', 'olt-1', samples, {
      now: NOW,
      minSamples: 4,
    });
    expect(finding).toBeNull();
  });

  it('evaluates devices independently', () => {
    const high = detectTrafficAnomaly(
      'ONU',
      'onu-high',
      series([150, 150, 150]),
      { now: NOW },
    );
    const low = detectTrafficAnomaly(
      'ONU',
      'onu-low',
      series([10, 10, 10]),
      { now: NOW },
    );
    expect(high?.kind).toBe('traffic_anomaly');
    expect(low).toBeNull();
  });

  it('respects custom threshold', () => {
    const finding = detectTrafficAnomaly(
      'ONU',
      'onu-1',
      series([50, 50, 50]),
      { now: NOW, thresholdMbps: 40 },
    );
    expect(finding?.kind).toBe('traffic_anomaly');
  });

  it('returns null for empty samples', () => {
    expect(detectTrafficAnomaly('ONU', 'onu-1', [], { now: NOW })).toBeNull();
  });
});
