export type DeviceStatus = 'online' | 'offline' | 'degraded';

export interface StatusSample {
  /** Unix epoch milliseconds. */
  t: number;
  status: DeviceStatus;
}

export interface UptimeWindow {
  from: number;
  to: number;
}

/**
 * Result of an uptime computation over a window.
 *
 * The window is split into two regions:
 *   - measured time: the segment between adjacent samples (and the
 *     single-point segments that fall strictly between the first and
 *     last sample);
 *   - unmeasured time: every other instant — i.e. the time BEFORE the
 *     first sample (backfilled gap) and AFTER the last sample
 *     (forward-fill gap). The previous implementation counted these
 *     regions as having the first/last sample's status, which let a
 *     single same-day sample report 100% uptime for a 30-day window.
 *     That was unsafe: a "status: online" sample taken today tells us
 *     "the device is online NOW", not "it was online for the previous
 *     30 days". Pinning these regions as unmeasured lets a UI
 *     distinguish "100% uptime on a fully-monitored window" from
 *     "100% uptime on a window where 99% was never observed".
 *
 * `uptimePercent` is computed on `measuredMs` and is `null` when
 * `measuredMs === 0` (no two adjacent samples, so no status segment
 * exists to score). Reporting a number in that case would either be a
 * lie (treating the window as covered) or zero (indistinguishable from
 * "0% measured uptime"). `null` is the unambiguous "insufficient data"
 * signal.
 *
 * `coveragePercent` is always reported (0..100) so dashboards can
 * surface the unmeasured fraction regardless of the uptime verdict.
 */
export interface UptimeResult {
  onlineMs: number;
  degradedMs: number;
  offlineMs: number;
  /** Length of the window in ms. */
  totalMs: number;
  /** Length of the window actually backed by at least one sample-to-sample interval. */
  measuredMs: number;
  /** totalMs - measuredMs. */
  unmeasuredMs: number;
  /** measuredMs / totalMs * 100, 0..100. */
  coveragePercent: number;
  /**
   * onlineMs / measuredMs * 100, 0..100; `null` when `measuredMs === 0`
   * (i.e. no two adjacent samples landed inside the window).
   */
  uptimePercent: number | null;
}

/**
 * Computes uptime over a window from point-in-time status samples.
 *
 * Semantics (corrected from the previous version):
 *   - A sample's status holds from its timestamp until the NEXT sample.
 *     The interval between two samples is MEASURED time and contributes
 *     to the uptime numerator using the EARLIER sample's status.
 *   - The time BEFORE the first sample and AFTER the last sample is
 *     UNMEASURED time. It does NOT contribute to the uptime numerator
 *     and does NOT count as covered. Pinning this prevents the
 *     "single sample = 100% uptime" failure mode (the original bug).
 *   - Returns `null` when the window is empty or there are no samples
 *     in it (caller cannot tell how to split the time into status
 *     buckets at all).
 *
 * For callers that need the previous "back/forward-fill" behavior
 * (treat the unmeasured regions as having the first/last sample's
 * status), use the `coveragePercent` and `unmeasuredMs` fields to
 * decide and document the assumption explicitly.
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

  const totals = { online: 0, degraded: 0, offline: 0 };

  // Iterate over consecutive sample pairs. Each gap contributes the
  // earlier sample's status to MEASURED time. The single-sample edge
  // case (one sample in the window) yields measuredMs === 0 because
  // there is no "next sample" to bound a status segment.
  let measuredMs = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    const gap = sorted[i + 1]!.t - sorted[i]!.t;
    if (gap <= 0) continue;
    totals[sorted[i]!.status] += gap;
    measuredMs += gap;
  }

  const onlineMs = totals.online;
  const degradedMs = totals.degraded;
  const offlineMs = totals.offline;
  const totalMs = to - from;
  const unmeasuredMs = totalMs - measuredMs;
  const coveragePercent =
    totalMs > 0 ? Math.min(100, Math.max(0, (measuredMs / totalMs) * 100)) : 0;
  const uptimePercent =
    measuredMs > 0
      ? Math.min(100, Math.max(0, (onlineMs / measuredMs) * 100))
      : null;

  return {
    onlineMs,
    degradedMs,
    offlineMs,
    totalMs,
    measuredMs,
    unmeasuredMs,
    coveragePercent,
    uptimePercent,
  };
}
