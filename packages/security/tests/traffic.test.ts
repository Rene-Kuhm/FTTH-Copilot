import { describe, it, expect } from 'vitest';
import { detectTrafficAnomaly } from '../src/traffic';
import type { DeviceTraffic } from '../src/traffic';

const NOW = 1_752_000_000_000;
const MIN = 60 * 1000;

function device(values: number[], overrides: Partial<DeviceTraffic> = {}): DeviceTraffic {
  return {
    deviceKind: 'ONU',
    deviceId: 'onu-1',
    samples: values.map((v, i) => ({ t: NOW - (values.length - 1 - i) * MIN, v })),
    ...overrides,
  };
}

describe('detectTrafficAnomaly', () => {
  it('flags sustained high throughput', () => {
    const findings = detectTrafficAnomaly([device([150, 160, 140])], {
      now: NOW,
      thresholdMbps: 100,
      minSamples: 3,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.kind).toBe('traffic_anomaly');
    expect(findings[0]!.severity).toBe('warning');
  });

  it('escalates to critical at 2x the threshold', () => {
    const findings = detectTrafficAnomaly([device([250, 260, 240])], {
      now: NOW,
      thresholdMbps: 100,
      minSamples: 3,
    });
    expect(findings[0]!.severity).toBe('critical');
  });

  it('does not flag below the threshold', () => {
    const findings = detectTrafficAnomaly([device([50, 60, 40])], {
      now: NOW,
      thresholdMbps: 100,
      minSamples: 3,
    });
    expect(findings).toEqual([]);
  });

  it('ignores samples outside the window', () => {
    const findings = detectTrafficAnomaly(
      [{ deviceKind: 'ONU', deviceId: 'onu-1', samples: [{ t: NOW - 60 * MIN, v: 500 }] }],
      { now: NOW, windowMs: 10 * MIN, thresholdMbps: 100, minSamples: 1 },
    );
    expect(findings).toEqual([]);
  });

  it('requires minSamples', () => {
    const findings = detectTrafficAnomaly([device([500, 600])], {
      now: NOW,
      thresholdMbps: 100,
      minSamples: 3,
    });
    expect(findings).toEqual([]);
  });

  it('evaluates each device independently', () => {
    const findings = detectTrafficAnomaly(
      [
        device([150, 160, 140], { deviceId: 'onu-1' }),
        device([20, 30, 25], { deviceId: 'onu-2' }),
      ],
      { now: NOW, thresholdMbps: 100, minSamples: 3 },
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.id).toBe('traffic-anomaly-ONU-onu-1');
  });
});
