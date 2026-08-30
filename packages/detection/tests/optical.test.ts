import { describe, expect, it } from 'vitest';
import { detectOpticalDegradation } from '../src/optical';

const NOW = 1_752_000_000_000;
const HOUR = 60 * 60 * 1000;

function series(values: number[]): Array<{ t: number; v: number }> {
  return values.map((v, i) => ({ t: NOW - (values.length - 1 - i) * HOUR, v }));
}

describe('detectOpticalDegradation', () => {
  it('returns a warning when bias current is below the healthy band', () => {
    const finding = detectOpticalDegradation(
      'ONU',
      'onu-1',
      series([0.9, 1.0, 1.1]),
      [],
      { now: NOW },
    );
    expect(finding?.kind).toBe('optical_degradation');
    expect(finding?.severity).toBe('warning');
  });

  it('returns a warning when bias current is above the healthy band', () => {
    const finding = detectOpticalDegradation(
      'ONU',
      'onu-1',
      series([45, 46, 47]),
      [],
      { now: NOW },
    );
    expect(finding?.severity).toBe('warning');
  });

  it('returns critical when ONT temperature exceeds the ceiling', () => {
    const finding = detectOpticalDegradation(
      'ONU',
      'onu-1',
      [],
      series([71, 72, 73]),
      { now: NOW },
    );
    expect(finding?.kind).toBe('optical_degradation');
    expect(finding?.severity).toBe('critical');
  });

  it('returns null when both signals are healthy', () => {
    const finding = detectOpticalDegradation(
      'ONU',
      'onu-1',
      series([12, 13, 14]),
      series([50, 51, 52]),
      { now: NOW },
    );
    expect(finding).toBeNull();
  });

  it('returns null with too few samples', () => {
    const finding = detectOpticalDegradation(
      'ONU',
      'onu-1',
      series([99, 99]),
      [],
      { now: NOW, minSamples: 3 },
    );
    expect(finding).toBeNull();
  });
});
