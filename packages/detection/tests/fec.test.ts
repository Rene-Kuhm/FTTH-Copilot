import { describe, expect, it } from 'vitest';
import { detectFecDegradation } from '../src/fec';

const NOW = 1_752_000_000_000;
const HOUR = 60 * 60 * 1000;

function series(values: number[]): Array<{ t: number; v: number }> {
  return values.map((v, i) => ({ t: NOW - (values.length - 1 - i) * HOUR, v }));
}

describe('detectFecDegradation', () => {
  it('returns critical when uncorrectable codewords appear', () => {
    const finding = detectFecDegradation(
      'ONU',
      'onu-1',
      series([0, 10, 20, 30]),
      series([0, 0, 0, 5]),
      { now: NOW },
    );
    expect(finding?.kind).toBe('fec_degradation');
    expect(finding?.severity).toBe('critical');
  });

  it('returns a warning when corrected codewords grow past the threshold', () => {
    const finding = detectFecDegradation(
      'ONU',
      'onu-1',
      series([0, 50, 100, 250]),
      series([0, 0, 0, 0]),
      { now: NOW, correctedDeltaThreshold: 100 },
    );
    expect(finding?.kind).toBe('fec_degradation');
    expect(finding?.severity).toBe('warning');
  });

  it('returns null when the corrected delta is below the threshold', () => {
    const finding = detectFecDegradation(
      'ONU',
      'onu-1',
      series([0, 10, 20, 30]),
      series([0, 0, 0, 0]),
      { now: NOW, correctedDeltaThreshold: 100 },
    );
    expect(finding).toBeNull();
  });

  it('returns null with too few samples for a warning', () => {
    const finding = detectFecDegradation(
      'ONU',
      'onu-1',
      series([0, 999]),
      series([0, 0]),
      { now: NOW, minSamples: 3 },
    );
    expect(finding).toBeNull();
  });

  it('treats a counter reset (last < first) as zero delta', () => {
    const finding = detectFecDegradation(
      'ONU',
      'onu-1',
      series([500, 400, 300, 200]),
      series([0, 0, 0, 0]),
      { now: NOW },
    );
    expect(finding).toBeNull();
  });

  it('uses both window boundaries and ignores samples outside them', () => {
    const uncorrected = [
      { t: NOW, v: 12 },
      { t: NOW + 1, v: 0 },
      { t: NOW - HOUR - 1, v: 99 },
      { t: NOW - HOUR, v: 10 },
    ];
    const finding = detectFecDegradation('ONU', 'onu-1', [], uncorrected, {
      now: NOW,
      windowMs: HOUR,
    });

    expect(finding).toMatchObject({
      severity: 'critical',
      detectedAt: new Date(NOW).toISOString(),
    });
    expect(finding?.description).toMatch(/^2 codewords/);
  });

  it.each([
    { delta: 100, severity: null },
    { delta: 101, severity: 'warning' },
  ])('applies the default corrected threshold to exactly three samples ($delta)', ({ delta, severity }) => {
    const finding = detectFecDegradation('ONU', 'onu-1', series([0, 50, delta]), [], { now: NOW });

    expect(finding?.severity ?? null).toBe(severity);
  });
});
