import type { Finding, DeviceKind, NumericSample } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface LosOptions {
  now?: number;
  /** Observation window (ms). */
  windowMs?: number;
  /** Minimum samples required before a counter-delta warning is emitted. */
  minSamples?: number;
  /** Counter-delta over the window at or above this value is a warning. */
  warningDelta?: number;
  /** Counter-delta over the window at or above this value is critical. */
  criticalDelta?: number;
}

function windowed(samples: NumericSample[], now: number, windowMs: number): NumericSample[] {
  return samples
    .filter((s) => s.t >= now - windowMs && s.t <= now)
    .sort((a, b) => a.t - b.t);
}

/** Monotonic-counter delta over the window; 0 when < 2 samples or counter reset. */
function counterDelta(series: NumericSample[]): number {
  if (series.length < 2) return 0;
  return Math.max(0, series[series.length - 1]!.v - series[0]!.v);
}

/**
 * Detects Loss-of-Signal (LOS) events on an ONU. `losSecondsTotal` is a
 * monotonic counter (seconds since ONU last boot). A counter that is rising
 * means the fiber or optical path has dropped; a flat counter means the
 * ONU has been healthy.
 *
 * Severity ladder:
 *   - delta ≥ 30 s over the window → critical (sustained outage signal)
 *   - delta ≥ 1 s over the window, ≥ minSamples  → warning (early degradation)
 *   - delta < 1 s but the most-recent sample is strictly greater than the
 *     immediately prior sample → warning ("LOS just started"; the very
 *     last tick accrued a non-zero LOS step, even if window total is small).
 *   - otherwise → null
 */
export function detectLosEvents(
  deviceKind: DeviceKind,
  deviceId: string,
  losSecondsTotal: NumericSample[],
  opts: LosOptions = {},
): Finding | null {
  const now = opts.now ?? Date.now();
  const windowMs = opts.windowMs ?? DAY_MS;
  const minSamples = opts.minSamples ?? 3;
  const warningDelta = opts.warningDelta ?? 1;
  const criticalDelta = opts.criticalDelta ?? 30;

  const window = windowed(losSecondsTotal, now, windowMs);
  const delta = counterDelta(window);

  if (delta >= criticalDelta) {
    return {
      id: `los-events-${deviceKind}-${deviceId}`,
      kind: 'optical_degradation',
      severity: 'critical',
      deviceKind,
      deviceId,
      title: `Pérdida de señal (LOS) en ${deviceId}`,
      description: `LOS acumulado ${delta}s en ventana de ${windowMs / 3.6e6}h — corte o pérdida óptica sostenida.`,
      detectedAt: new Date(now).toISOString(),
    };
  }

  if (window.length >= minSamples && delta >= warningDelta) {
    return {
      id: `los-events-${deviceKind}-${deviceId}`,
      kind: 'optical_degradation',
      severity: 'warning',
      deviceKind,
      deviceId,
      title: `Pérdida de señal (LOS) en ${deviceId}`,
      description: `LOS acumulado ${delta}s en ventana de ${windowMs / 3.6e6}h — la fibra está perdiendo señal.`,
      detectedAt: new Date(now).toISOString(),
    };
  }

  // Recent-spike rule: the counter just incremented on the last interval
  // (last > second-to-last). The window total is below the warning threshold,
  // but a non-zero step at the very latest tick is an active-LOS signal —
  // "LOS just started", treat as warning.
  if (
    window.length >= 2 &&
    delta < warningDelta &&
    window[window.length - 1]!.v > window[window.length - 2]!.v
  ) {
    return {
      id: `los-events-${deviceKind}-${deviceId}`,
      kind: 'optical_degradation',
      severity: 'warning',
      deviceKind,
      deviceId,
      title: `Pérdida de señal (LOS) en ${deviceId}`,
      description: `LOS en aumento en la última muestra (${window[window.length - 1]!.v}s) — corte de fibra recién iniciado.`,
      detectedAt: new Date(now).toISOString(),
    };
  }

  return null;
}
