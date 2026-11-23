import { describe, expect, it } from 'vitest';
import { detectLosEvents } from '../src/los';

const NOW = 1_752_000_000_000;
const HOUR = 60 * 60 * 1000;

function series(values: number[]): Array<{ t: number; v: number }> {
  return values.map((v, i) => ({ t: NOW - (values.length - 1 - i) * HOUR, v }));
}

describe('detectLosEvents', () => {
  it('returns null for an empty series', () => {
    const finding = detectLosEvents('ONU', 'onu-1', [], { now: NOW });
    expect(finding).toBeNull();
  });

  it('returns null when the series has fewer than minSamples samples', () => {
    // Two samples — below default minSamples=3.
    const finding = detectLosEvents(
      'ONU',
      'onu-1',
      series([10, 20]),
      { now: NOW },
    );
    expect(finding).toBeNull();
  });

  it('returns null when consecutive samples are equal (no LOS accrual)', () => {
    // Counter stuck — fiber is healthy, just no LOS seconds added.
    const finding = detectLosEvents(
      'ONU',
      'onu-1',
      series([0, 0, 0, 0]),
      { now: NOW },
    );
    expect(finding).toBeNull();
  });

  it('returns a warning when the counter-delta over the window is at or above 1s', () => {
    // 1s delta over 24h — minimum warning signal.
    const finding = detectLosEvents(
      'ONU',
      'onu-1',
      series([0, 0, 1]),
      { now: NOW },
    );
    expect(finding?.kind).toBe('optical_degradation');
    expect(finding?.severity).toBe('warning');
    expect(finding?.title).toBe('Pérdida de señal (LOS) en onu-1');
  });

  it('returns critical when the counter-delta over the window is at or above 30s', () => {
    // An exact 30s delta reaches the critical threshold.
    const finding = detectLosEvents(
      'ONU',
      'onu-1',
      series([0, 30]),
      { now: NOW },
    );
    expect(finding?.kind).toBe('optical_degradation');
    expect(finding?.severity).toBe('critical');
  });

  it('returns a warning when the counter just incremented (recent spike), even if the window total is below the warning threshold', () => {
    // Last sample > second-to-last: LOS just started. Total delta < 1s
    // (would otherwise return null per the steady-state rule), but the
    // counter increment on the latest sample is an active-LOS signal.
    const finding = detectLosEvents(
      'ONU',
      'onu-1',
      series([0, 0.5]),
      { now: NOW },
    );
    expect(finding?.kind).toBe('optical_degradation');
    expect(finding?.severity).toBe('warning');
  });

  it('measures LOS from the oldest to the newest sample inside the closed window', () => {
    const samples = [
      { t: NOW, v: 40 },
      { t: NOW + 1, v: 80 },
      { t: NOW - HOUR - 1, v: 0 },
      { t: NOW - HOUR, v: 10 },
    ];
    const finding = detectLosEvents('ONU', 'onu-1', samples, { now: NOW, windowMs: HOUR });

    expect(finding?.severity).toBe('critical');
    expect(finding?.description).toContain('30s en ventana de 1h');
  });
});
