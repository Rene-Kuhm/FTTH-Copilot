import { describe, it, expect } from 'vitest';
import { detectFlapping } from '../src/flapping';
import type { StatusSample } from '../src/types';

const NOW = 1_752_000_000_000;
const HOUR = 60 * 60 * 1000;

function statusSeries(
  statuses: Array<'online' | 'offline' | 'degraded'>,
  stepMs = HOUR,
): StatusSample[] {
  return statuses.map((status, i) => ({ t: NOW - (statuses.length - 1 - i) * stepMs, status }));
}

describe('detectFlapping', () => {
  it('flags a flapping device', () => {
    const f = detectFlapping('ONU', 'onu-1', statusSeries(['online', 'offline', 'online', 'offline']), { now: NOW });
    expect(f).not.toBeNull();
    expect(f!.kind).toBe('intermittent_connection');
    expect(f!.deviceKind).toBe('ONU');
    expect(f!.deviceId).toBe('onu-1');
    expect(f!.severity).toBe('warning');
    expect(f!.id).toBe('intermittent-ONU-onu-1');
  });

  it('returns null for a stable device', () => {
    expect(detectFlapping('ONU', 'onu-1', statusSeries(['online', 'online', 'online', 'online']), { now: NOW })).toBeNull();
  });

  it('returns null when flaps are below the minimum', () => {
    const f = detectFlapping('ONU', 'onu-1', statusSeries(['online', 'offline', 'online']), { now: NOW, minFlaps: 3 });
    expect(f).toBeNull();
  });

  it('ignores samples outside the window', () => {
    const samples: StatusSample[] = [
      { t: NOW - 2 * HOUR, status: 'online' },
      { t: NOW - 1 * HOUR, status: 'online' },
      { t: NOW - 48 * HOUR, status: 'offline' },
    ];
    expect(detectFlapping('ONU', 'onu-1', samples, { now: NOW })).toBeNull();
  });

  it('returns null with fewer than two samples', () => {
    expect(detectFlapping('ONU', 'onu-1', statusSeries(['online']), { now: NOW })).toBeNull();
  });
});
