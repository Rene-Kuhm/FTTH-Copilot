import { describe, it, expect } from 'vitest';
import { predictThresholdCrossing } from '../src/trend';
import { DAY_MS } from '../src/stats';

function series(values: number[]): Array<{ t: number; v: number }> {
  return values.map((v, i) => ({ t: i * DAY_MS, v }));
}

describe('predictThresholdCrossing', () => {
  const opts = {
    threshold: -27,
    direction: 'below' as const,
    horizonDays: 7,
    minSamples: 5,
    minR2: 0.5,
  };

  it('returns a prediction for a descending trend within the horizon', () => {
    const p = predictThresholdCrossing(series([-22, -23, -24, -25, -26]), opts);
    expect(p).not.toBeNull();
    expect(p!.etaMs).toBeCloseTo(DAY_MS, 5);
    expect(p!.slopePerDay).toBeCloseTo(-1, 5);
    expect(p!.confidence).toBeCloseTo(1, 5);
  });

  it('returns null with too few samples', () => {
    expect(predictThresholdCrossing(series([-22, -23]), opts)).toBeNull();
  });

  it('returns null when the trend goes the wrong way', () => {
    expect(predictThresholdCrossing(series([-26, -25, -24, -23, -22]), opts)).toBeNull();
  });

  it('returns null when already past the threshold', () => {
    expect(predictThresholdCrossing(series([-27, -27.5, -28, -28.5, -29]), opts)).toBeNull();
  });

  it('returns null when the crossing is beyond the horizon', () => {
    expect(predictThresholdCrossing(series([-22, -22.1, -22.2, -22.3, -22.4]), opts)).toBeNull();
  });

  it('returns null when minR2 cannot be satisfied', () => {
    expect(predictThresholdCrossing(series([-22, -23, -24, -25, -26]), { ...opts, minR2: 2 })).toBeNull();
  });

  it('honors direction "above" for temperature-style thresholds', () => {
    const p = predictThresholdCrossing(series([50, 52, 54, 56, 58]), {
      threshold: 60,
      direction: 'above',
      horizonDays: 7,
      minSamples: 5,
      minR2: 0.5,
    });
    expect(p).not.toBeNull();
    expect(p!.etaMs).toBeCloseTo(DAY_MS, 5);
    expect(p!.slopePerDay).toBeCloseTo(2, 5);
  });
});
