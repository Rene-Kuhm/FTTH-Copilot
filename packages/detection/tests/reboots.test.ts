import { describe, it, expect } from 'vitest';
import { detectRebootStorm } from '../src/reboots';
import type { UptimeSample } from '../src/types';

const NOW = 1_752_000_000_000;
const HOUR = 60 * 60 * 1000;

function uptimeSeries(uptimes: number[], stepMs = HOUR): UptimeSample[] {
  return uptimes.map((u, i) => ({ t: NOW - (uptimes.length - 1 - i) * stepMs, uptimeSeconds: u }));
}

describe('detectRebootStorm', () => {
  it('flags repeated reboots (uptime resets)', () => {
    const f = detectRebootStorm(
      'ONU',
      'onu-1',
      uptimeSeries([100, 3600, 100, 3600, 100, 3600, 100]),
      { now: NOW },
    );
    expect(f).not.toBeNull();
    expect(f!.kind).toBe('frequent_reboots');
    expect(f!.deviceKind).toBe('ONU');
    expect(f!.deviceId).toBe('onu-1');
    expect(f!.id).toBe('frequent-reboots-ONU-onu-1');
  });

  it('returns null when uptime is monotonic', () => {
    expect(detectRebootStorm('ONU', 'onu-1', uptimeSeries([100, 200, 300, 400, 500]), { now: NOW })).toBeNull();
  });

  it('returns null below the minimum reboot count', () => {
    const f = detectRebootStorm('ONU', 'onu-1', uptimeSeries([100, 3600, 100, 3600, 100]), {
      now: NOW,
      minReboots: 3,
    });
    expect(f).toBeNull();
  });

  it('ignores samples outside the window', () => {
    const samples: UptimeSample[] = [
      { t: NOW - 2 * HOUR, uptimeSeconds: 100 },
      { t: NOW - 1 * HOUR, uptimeSeconds: 200 },
      { t: NOW - 48 * HOUR, uptimeSeconds: 999999 },
    ];
    expect(detectRebootStorm('ONU', 'onu-1', samples, { now: NOW })).toBeNull();
  });

  it('returns null with fewer than two samples', () => {
    expect(detectRebootStorm('ONU', 'onu-1', uptimeSeries([100]), { now: NOW })).toBeNull();
  });
});
