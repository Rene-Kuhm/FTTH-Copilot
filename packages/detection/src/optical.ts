import type { Finding, DeviceKind, NumericSample } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface OpticalDegradationOptions {
  now?: number;
  /** Observation window (ms). */
  windowMs?: number;
  minSamples?: number;
  /** Healthy laser bias-current band (mA). */
  biasMinMa?: number;
  biasMaxMa?: number;
  /** ONT temperature ceiling (°C). */
  tempMaxC?: number;
}

function recentAverage(
  samples: NumericSample[],
  now: number,
  windowMs: number,
  minSamples: number,
): number | null {
  const window = samples
    .filter((s) => s.t >= now - windowMs && s.t <= now)
    .sort((a, b) => a.t - b.t);
  if (window.length < minSamples) return null;
  return window.reduce((sum, s) => sum + s.v, 0) / window.length;
}

/**
 * Detects ONT optical-health degradation from bias current (laser aging /
 * failing) or ONT temperature. Bias outside the healthy band is a warning;
 * temperature above the ceiling is critical (overheating is imminent).
 */
export function detectOpticalDegradation(
  deviceKind: DeviceKind,
  deviceId: string,
  biasCurrent: NumericSample[],
  ontTemperature: NumericSample[],
  opts: OpticalDegradationOptions = {},
): Finding | null {
  const now = opts.now ?? Date.now();
  const windowMs = opts.windowMs ?? DAY_MS;
  const minSamples = opts.minSamples ?? 3;
  const biasMin = opts.biasMinMa ?? 2;
  const biasMax = opts.biasMaxMa ?? 40;
  const tempMax = opts.tempMaxC ?? 70;

  const biasAvg = recentAverage(biasCurrent, now, windowMs, minSamples);
  const tempAvg = recentAverage(ontTemperature, now, windowMs, minSamples);

  if (biasAvg !== null && (biasAvg < biasMin || biasAvg > biasMax)) {
    return {
      id: `optical-degradation-${deviceKind}-${deviceId}`,
      kind: 'optical_degradation',
      severity: 'warning',
      deviceKind,
      deviceId,
      title: `Bias current fuera de rango: ${deviceId}`,
      description:
        `Bias current promedio de ${biasAvg.toFixed(1)} mA (banda ${biasMin}–${biasMax} mA) — posible envejecimiento del láser.`,
      detectedAt: new Date(now).toISOString(),
    };
  }

  if (tempAvg !== null && tempAvg > tempMax) {
    return {
      id: `optical-degradation-${deviceKind}-${deviceId}`,
      kind: 'optical_degradation',
      severity: 'critical',
      deviceKind,
      deviceId,
      title: `Temperatura ONT alta: ${deviceId}`,
      description: `Temperatura promedio de ${tempAvg.toFixed(1)} °C (límite ${tempMax} °C).`,
      detectedAt: new Date(now).toISOString(),
    };
  }

  return null;
}
