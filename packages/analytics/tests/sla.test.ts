import { describe, it, expect } from 'vitest';
import { computeUptime } from '../src/sla';
import type { StatusSample } from '../src/sla';

const MIN = 60 * 1000;
const FROM = 1_752_000_000_000; // epoch ms
const TO = FROM + 10 * MIN; // 10-minute window

describe('computeUptime', () => {
  it('computes 100% uptime for a fully online window', () => {
    const samples: StatusSample[] = [
      { t: FROM, status: 'online' },
      { t: FROM + 5 * MIN, status: 'online' },
    ];
    const result = computeUptime(samples, { from: FROM, to: TO });
    expect(result!.uptimePercent).toBe(100);
    expect(result!.onlineMs).toBe(TO - FROM);
  });

  it('computes 0% uptime for a fully offline window', () => {
    const samples: StatusSample[] = [{ t: FROM, status: 'offline' }];
    const result = computeUptime(samples, { from: FROM, to: TO });
    expect(result!.uptimePercent).toBe(0);
    expect(result!.offlineMs).toBe(TO - FROM);
  });

  it('splits time at a status transition', () => {
    const samples: StatusSample[] = [
      { t: FROM, status: 'online' },
      { t: FROM + 4 * MIN, status: 'offline' },
    ];
    const result = computeUptime(samples, { from: FROM, to: TO });
    expect(result!.onlineMs).toBe(4 * MIN);
    expect(result!.offlineMs).toBe(6 * MIN);
    expect(result!.uptimePercent).toBe(40);
  });

  it('ignores samples outside the window', () => {
    const samples: StatusSample[] = [
      { t: FROM - 10 * MIN, status: 'offline' },
      { t: FROM, status: 'online' },
      { t: TO + 5 * MIN, status: 'offline' },
    ];
    const result = computeUptime(samples, { from: FROM, to: TO });
    expect(result!.uptimePercent).toBe(100);
  });

  it('returns null for an empty window', () => {
    expect(computeUptime([], { from: TO, to: FROM })).toBeNull();
  });

  it('returns null when there are no samples in the window', () => {
    const samples: StatusSample[] = [{ t: FROM - 10 * MIN, status: 'online' }];
    expect(computeUptime(samples, { from: FROM, to: TO })).toBeNull();
  });

  it('accounts for degraded time separately', () => {
    const samples: StatusSample[] = [
      { t: FROM, status: 'online' },
      { t: FROM + 4 * MIN, status: 'degraded' },
      { t: FROM + 8 * MIN, status: 'online' },
    ];
    const result = computeUptime(samples, { from: FROM, to: TO });
    expect(result!.degradedMs).toBe(4 * MIN);
    expect(result!.onlineMs).toBe(6 * MIN);
  });
});
