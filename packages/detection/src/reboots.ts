import type { Finding, UptimeSample, DeviceKind } from './types';

const HOUR_MS = 60 * 60 * 1000;

export interface RebootStormOptions {
  /** Observation window (ms). */
  windowMs?: number;
  /** Minimum uptime resets within the window to flag. */
  minReboots?: number;
  now?: number;
}

/**
 * Detects repeated reboots by observing the monotonic uptime counter: any
 * decrease between consecutive samples means the device restarted. A storm of
 * reboots signals power, firmware or thermal instability.
 */
export function detectRebootStorm(
  deviceKind: DeviceKind,
  deviceId: string,
  samples: UptimeSample[],
  opts: RebootStormOptions = {},
): Finding | null {
  const now = opts.now ?? Date.now();
  const windowMs = opts.windowMs ?? 24 * HOUR_MS;
  const minReboots = opts.minReboots ?? 3;

  const recent = [...samples]
    .sort((a, b) => a.t - b.t)
    .filter((s) => now - s.t <= windowMs);
  if (recent.length < 2) return null;

  let reboots = 0;
  for (let i = 1; i < recent.length; i++) {
    if (recent[i]!.uptimeSeconds < recent[i - 1]!.uptimeSeconds) reboots++;
  }
  if (reboots < minReboots) return null;

  return {
    id: `frequent-reboots-${deviceKind}-${deviceId}`,
    kind: 'frequent_reboots',
    severity: 'warning',
    deviceKind,
    deviceId,
    title: `Reinicios repetidos: ${deviceId}`,
    description:
      `${reboots} reinicios detectados en las últimas ${Math.round(windowMs / HOUR_MS)} h.`,
    detectedAt: new Date(now).toISOString(),
  };
}
