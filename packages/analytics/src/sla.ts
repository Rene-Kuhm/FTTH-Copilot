export type DeviceStatus = 'online' | 'offline' | 'degraded';

export interface StatusSample {
  /** Unix epoch milliseconds. */
  t: number;
  status: DeviceStatus;
}

export interface UptimeResult {
  onlineMs: number;
  degradedMs: number;
  offlineMs: number;
  totalMs: number;
  /** Percentage of the window the device was online, 0..100. */
  uptimePercent: number;
}

export interface UptimeWindow {
  from: number;
  to: number;
}

/**
 * Computes uptime over a window from point-in-time status samples. A sample's
 * status holds from its timestamp until the next sample; the first sample's
 * status is backfilled to `from` and the last sample's status is extended to
 * `to`. Returns null when the window is empty or there are no samples in it.
 */
export function computeUptime(
  samples: StatusSample[],
  window: UptimeWindow,
): UptimeResult | null {
  const { from, to } = window;
  if (to <= from) return null;

  const sorted = samples
    .filter((s) => s.t >= from && s.t <= to)
    .sort((a, b) => a.t - b.t);
  if (sorted.length === 0) return null;

  const onlineMs = { online: 0, degraded: 0, offline: 0 };

  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;

  onlineMs[first.status] += first.t - from;
  for (let i = 0; i < sorted.length - 1; i++) {
    onlineMs[sorted[i]!.status] += sorted[i + 1]!.t - sorted[i]!.t;
  }
  onlineMs[last.status] += to - last.t;

  const totalMs = to - from;
  const uptimePercent = Math.min(100, Math.max(0, (onlineMs.online / totalMs) * 100));

  return {
    onlineMs: onlineMs.online,
    degradedMs: onlineMs.degraded,
    offlineMs: onlineMs.offline,
    totalMs,
    uptimePercent,
  };
}
