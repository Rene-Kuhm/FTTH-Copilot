import { describe, it, expect } from 'vitest';
import { median, mean, mad, fitTrend, DAY_MS } from '../src/stats';

describe('median', () => {
  it('returns the middle value for odd-length input', () => {
    expect(median([1, 3, 2])).toBe(2);
  });

  it('averages the two middle values for even-length input', () => {
    expect(median([1, 4, 2, 3])).toBe(2.5);
  });

  it('sorts input before computing', () => {
    expect(median([5, 1, 3])).toBe(3);
  });

  it('returns NaN for empty input', () => {
    expect(median([])).toBeNaN();
  });
});

describe('mean', () => {
  it('computes the arithmetic mean', () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
  });

  it('returns NaN for empty input', () => {
    expect(mean([])).toBeNaN();
  });
});

describe('mad', () => {
  it('computes the median absolute deviation', () => {
    // median is 2.5; deviations are [1.5,0.5,0.5,97.5] -> median 1.0
    expect(mad([1, 2, 3, 100])).toBe(1);
  });
});

describe('fitTrend', () => {
  it('fits a perfect linear series', () => {
    const s = [0, 1, 2, 3].map((d) => ({ t: d * DAY_MS, v: -d }));
    const fit = fitTrend(s);
    expect(fit).not.toBeNull();
    expect(fit!.slopePerDay).toBeCloseTo(-1, 6);
    expect(fit!.r2).toBeCloseTo(1, 6);
  });

  it('returns null for fewer than two samples', () => {
    expect(fitTrend([{ t: 0, v: 1 }])).toBeNull();
    expect(fitTrend([])).toBeNull();
  });

  it('returns null when time has no spread', () => {
    expect(fitTrend([{ t: 5, v: 1 }, { t: 5, v: 2 }])).toBeNull();
  });

  it('sorts samples by time before fitting', () => {
    const s = [
      { t: 3 * DAY_MS, v: -3 },
      { t: 0, v: 0 },
      { t: DAY_MS, v: -1 },
      { t: 2 * DAY_MS, v: -2 },
    ];
    const fit = fitTrend(s);
    expect(fit!.slopePerDay).toBeCloseTo(-1, 6);
  });
});
