import { describe, it, expect } from 'vitest';
import { detectTemperatureDrift } from '../src/temperature-drift';

const NOW = 1_752_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

function series(values: number[], stepMs = DAY): Array<{ t: number; v: number }> {
  return values.map((v, i) => ({ t: NOW - (values.length - 1 - i) * stepMs, v }));
}

describe('detectTemperatureDrift', () => {
  it('flags an upward temperature trend with an ETA within the horizon', () => {
    const f = detectTemperatureDrift('OLT', 'olt-1', series([50, 52, 54, 56, 58]), { now: NOW });
    expect(f).not.toBeNull();
    expect(f!.kind).toBe('predicted_high_temperature');
    expect(f!.deviceKind).toBe('OLT');
    expect(f!.deviceId).toBe('olt-1');
    expect(f!.severity).toBe('warning');
    expect(f!.etaMs).toBeCloseTo(DAY, 5);
    expect(f!.confidence).toBeCloseTo(1, 5);
    expect(f!.id).toBe('predicted-high-temperature-OLT-olt-1');
  });

  it('returns null for a descending trend', () => {
    expect(detectTemperatureDrift('OLT', 'olt-1', series([58, 56, 54, 52, 50]), { now: NOW })).toBeNull();
  });

  it('returns null when already above threshold', () => {
    expect(detectTemperatureDrift('OLT', 'olt-1', series([60, 61, 62, 63, 64]), { now: NOW })).toBeNull();
  });

  it('returns null with too few samples', () => {
    expect(detectTemperatureDrift('OLT', 'olt-1', series([50, 52, 54]), { now: NOW })).toBeNull();
  });

  it('returns null when the crossing is beyond the horizon', () => {
    expect(detectTemperatureDrift('OLT', 'olt-1', series([50, 50.2, 50.4, 50.6, 50.8]), { now: NOW })).toBeNull();
  });

  it('honors a custom threshold', () => {
    const f = detectTemperatureDrift('OLT', 'olt-1', series([50, 52, 54, 56, 58]), {
      now: NOW,
      thresholdCelsius: 59,
    });
    expect(f).not.toBeNull();
    expect(f!.etaMs).toBeCloseTo(DAY / 2, 5);
  });
});
