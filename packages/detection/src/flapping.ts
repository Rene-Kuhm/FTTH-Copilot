import type { Finding, StatusSample, DeviceKind } from './types';

const HOUR_MS = 60 * 60 * 1000;

export interface FlappingOptions {
  /** Observation window (ms). */
  windowMs?: number;
  /** Minimum state transitions within the window to flag. */
  minFlaps?: number;
  now?: number;
}

/**
 * Detects a device whose status oscillates (flapping) within a window. Flapping
 * is an early signal of physical-layer instability (dirty fiber, marginal light
 * levels, loose splice) before a hard offline.
 */
export function detectFlapping(
  deviceKind: DeviceKind,
  deviceId: string,
  samples: StatusSample[],
  opts: FlappingOptions = {},
): Finding | null {
  const now = opts.now ?? Date.now();
  const windowMs = opts.windowMs ?? 24 * HOUR_MS;
  const minFlaps = opts.minFlaps ?? 3;

  const recent = [...samples]
    .sort((a, b) => a.t - b.t)
    .filter((s) => now - s.t <= windowMs);
  if (recent.length < 2) return null;

  let flaps = 0;
  for (let i = 1; i < recent.length; i++) {
    if (recent[i]!.status !== recent[i - 1]!.status) flaps++;
  }
  if (flaps < minFlaps) return null;

  return {
    id: `intermittent-${deviceKind}-${deviceId}`,
    kind: 'intermittent_connection',
    severity: 'warning',
    deviceKind,
    deviceId,
    title: `Conexión intermitente: ${deviceId}`,
    description:
      `${flaps} cambios de estado en las últimas ${Math.round(windowMs / HOUR_MS)} h ` +
      `(posible inestabilidad de planta externa o de la ONU).`,
    detectedAt: new Date(now).toISOString(),
  };
}
