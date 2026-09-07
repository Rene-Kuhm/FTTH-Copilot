import { describe, it, expect } from 'vitest';
import { computeUptime } from '../src/sla';
import type { StatusSample } from '../src/sla';

const MIN = 60 * 1000;
const FROM = 1_752_000_000_000; // epoch ms
const TO = FROM + 10 * MIN; // 10-minute window

describe('computeUptime', () => {
  it('computes 100% uptime for a fully online window with multiple samples', () => {
    // Two samples inside the window, both online. The gap between them
    // is MEASURED time. Pre/post regions are unmeasured. With two
    // samples, the gap covers most of the window.
    const samples: StatusSample[] = [
      { t: FROM, status: 'online' },
      { t: FROM + 8 * MIN, status: 'online' },
    ];
    const result = computeUptime(samples, { from: FROM, to: TO });
    expect(result!.uptimePercent).toBe(100);
    expect(result!.onlineMs).toBe(8 * MIN);
    // unmeasuredMs is the time outside the gap (before first + after last)
    expect(result!.unmeasuredMs).toBe(2 * MIN);
    expect(result!.coveragePercent).toBe(80);
  });

  it('returns 0% uptime for a window with only offline samples (no adjacency → uptime null)', () => {
    // Single sample means measuredMs === 0. uptimePercent must be null
    // (insufficient data), NOT 0. Pinning this prevents the
    // "1-sample = 0% uptime reported as a real measurement" failure.
    const samples: StatusSample[] = [{ t: FROM, status: 'offline' }];
    const result = computeUptime(samples, { from: FROM, to: TO });
    expect(result).not.toBeNull();
    expect(result!.uptimePercent).toBeNull();
    expect(result!.coveragePercent).toBe(0);
  });

  it('splits time at a status transition between adjacent samples', () => {
    // Two samples, gap of 4 minutes. The earlier sample's status holds
    // for the gap. Pre/post regions are unmeasured.
    const samples: StatusSample[] = [
      { t: FROM, status: 'online' },
      { t: FROM + 4 * MIN, status: 'offline' },
    ];
    const result = computeUptime(samples, { from: FROM, to: TO });
    expect(result!.onlineMs).toBe(4 * MIN);
    expect(result!.offlineMs).toBe(0); // the gap is 4min online; nothing else
    expect(result!.uptimePercent).toBe(100); // 100% of the measured 4min is online
    expect(result!.unmeasuredMs).toBe(6 * MIN);
    expect(result!.coveragePercent).toBe(40);
  });

  it('ignores samples outside the window', () => {
    const samples: StatusSample[] = [
      { t: FROM - 10 * MIN, status: 'offline' },
      { t: FROM, status: 'online' },
      { t: TO + 5 * MIN, status: 'offline' },
    ];
    const result = computeUptime(samples, { from: FROM, to: TO });
    // Only one sample lands inside the window → measuredMs === 0 → null.
    expect(result!.uptimePercent).toBeNull();
    expect(result!.coveragePercent).toBe(0);
  });

  it('returns null for an empty window', () => {
    expect(computeUptime([], { from: TO, to: FROM })).toBeNull();
  });

  it('returns null when there are no samples in the window', () => {
    const samples: StatusSample[] = [{ t: FROM - 10 * MIN, status: 'online' }];
    expect(computeUptime(samples, { from: FROM, to: TO })).toBeNull();
  });

  it('accounts for degraded time separately', () => {
    // Three samples; gaps cover 4 + 4 = 8 minutes of measured time.
    // Pre/post unmeasured: 1 + 1 = 2 minutes.
    const samples: StatusSample[] = [
      { t: FROM, status: 'online' },
      { t: FROM + 4 * MIN, status: 'degraded' },
      { t: FROM + 8 * MIN, status: 'online' },
    ];
    const result = computeUptime(samples, { from: FROM, to: TO });
    expect(result!.degradedMs).toBe(4 * MIN);
    expect(result!.onlineMs).toBe(4 * MIN);
    expect(result!.offlineMs).toBe(0);
    expect(result!.uptimePercent).toBe(50); // 4 / 8 measured minutes
    expect(result!.coveragePercent).toBe(80); // 8 / 10 minutes
  });

  // ── Regression: the "single sample = 100% uptime for 30 days" bug
  it('regression: a single sample does NOT produce 100% uptime for the surrounding window', () => {
    // The original bug report:
    //   "Con una sola muestra online de hoy puede devolver 100 % para
    //    los últimos 30 días, aunque no se haya monitoreado ese período."
    //
    // Pin the fix: one sample in a 30-day window → measuredMs === 0,
    // uptimePercent === null, coveragePercent === 0.
    const DAY_MS = 24 * 60 * 60 * 1000;
    const from = 1_752_000_000_000;
    const to = from + 30 * DAY_MS;
    const samples: StatusSample[] = [{ t: from + 30 * DAY_MS - 1, status: 'online' }];
    const result = computeUptime(samples, { from, to });
    expect(result).not.toBeNull();
    expect(result!.uptimePercent).toBeNull(); // NOT 100
    expect(result!.onlineMs).toBe(0);
    expect(result!.measuredMs).toBe(0);
    expect(result!.unmeasuredMs).toBe(30 * DAY_MS);
    expect(result!.coveragePercent).toBe(0);
  });

  it('does NOT backfill or forward-fill status into unmeasured regions', () => {
    // Two samples at FROM and TO. Gap covers 10 minutes.
    // Pre/post unmeasured regions are 0 minutes each (samples anchor
    // the exact window boundaries).
    const samples: StatusSample[] = [
      { t: FROM, status: 'online' },
      { t: TO, status: 'online' },
    ];
    const result = computeUptime(samples, { from: FROM, to: TO });
    expect(result!.uptimePercent).toBe(100);
    expect(result!.measuredMs).toBe(10 * MIN);
    expect(result!.unmeasuredMs).toBe(0);
    expect(result!.coveragePercent).toBe(100);
  });

  it('co-located identical samples (gap === 0) are skipped', () => {
    // Defensive: zero-length gaps must not contribute time nor crash.
    const samples: StatusSample[] = [
      { t: FROM, status: 'online' },
      { t: FROM, status: 'online' },
      { t: FROM + 5 * MIN, status: 'online' },
    ];
    const result = computeUptime(samples, { from: FROM, to: TO });
    // One real gap: FROM → FROM+5min = 5min. unmeasuredMs = 5min.
    expect(result!.onlineMs).toBe(5 * MIN);
    expect(result!.measuredMs).toBe(5 * MIN);
    expect(result!.uptimePercent).toBe(100);
  });
});
