import { describe, it, expect } from 'vitest';
import { detectSignalDrift } from '../src/signal-drift';

const NOW = 1_752_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

function series(values: number[], stepMs = DAY): Array<{ t: number; v: number }> {
  return values.map((v, i) => ({ t: NOW - (values.length - 1 - i) * stepMs, v }));
}

describe('detectSignalDrift', () => {
  it('flags a downward RX trend with an ETA within the horizon', () => {
    const f = detectSignalDrift('ONU', 'onu-1', series([-22, -23, -24, -25, -26]), { now: NOW });
    expect(f).not.toBeNull();
    expect(f!.kind).toBe('predicted_low_signal');
    expect(f!.deviceKind).toBe('ONU');
    expect(f!.deviceId).toBe('onu-1');
    expect(f!.severity).toBe('warning');
    expect(f!.etaMs).toBeCloseTo(DAY, 5);
    expect(f!.confidence).toBeCloseTo(1, 5);
    expect(f!.id).toBe('predicted-low-signal-ONU-onu-1');
  });

  it('returns null for an ascending trend', () => {
    expect(detectSignalDrift('ONU', 'onu-1', series([-26, -25, -24, -23, -22]), { now: NOW })).toBeNull();
  });

  it('returns null when already below threshold', () => {
    expect(detectSignalDrift('ONU', 'onu-1', series([-27, -28, -29, -30, -31]), { now: NOW })).toBeNull();
  });

  it('returns null with too few samples', () => {
    expect(detectSignalDrift('ONU', 'onu-1', series([-22, -23, -24]), { now: NOW })).toBeNull();
  });

  it('returns null when the crossing is beyond the horizon', () => {
    expect(detectSignalDrift('ONU', 'onu-1', series([-22, -22.1, -22.2, -22.3, -22.4]), { now: NOW })).toBeNull();
  });

  it('honors a custom minR2', () => {
    expect(detectSignalDrift('ONU', 'onu-1', series([-22, -23, -24, -25, -26]), { now: NOW, minR2: 2 })).toBeNull();
  });

  it('uses a deterministic detectedAt', () => {
    const f = detectSignalDrift('ONU', 'onu-1', series([-22, -23, -24, -25, -26]), { now: NOW });
    expect(f!.detectedAt).toBe(new Date(NOW).toISOString());
  });

  it('characterizes default threshold (-27 dBm) and explicit thresholdDbm override', () => {
    const defaultFinding = detectSignalDrift('ONU', 'onu-1', series([-22, -23, -24, -25, -26]), {
      now: NOW,
    });
    expect(defaultFinding).not.toBeNull();
    expect(defaultFinding!.etaMs).toBeCloseTo(DAY, 5);
    expect(defaultFinding!.description).toBe(
      'La potencia RX baja a -1.00 dBm/día y alcanzaría -27 dBm en ~1.0 día(s).',
    );

    const customFinding = detectSignalDrift('ONU', 'onu-1', series([-22, -23, -24, -25, -26]), {
      now: NOW,
      thresholdDbm: -28,
    });
    expect(customFinding).not.toBeNull();
    expect(customFinding!.etaMs).toBeCloseTo(2 * DAY, 5);
    expect(customFinding!.description).toBe(
      'La potencia RX baja a -1.00 dBm/día y alcanzaría -28 dBm en ~2.0 día(s).',
    );

    expect(
      detectSignalDrift('ONU', 'onu-1', series([-22, -23, -24, -25, -26]), {
        now: NOW,
        thresholdDbm: -25,
      }),
    ).toBeNull();
  });
});
