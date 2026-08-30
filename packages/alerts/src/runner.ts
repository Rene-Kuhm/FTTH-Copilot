import {
  detectSignalDrift,
  detectTemperatureDrift,
  detectFlapping,
  detectRebootStorm,
  detectBaselineAnomaly,
  type Finding,
} from '@ftth-copilot/detection';
import type { SeriesByDevice } from './types';

export interface RunnerOptions {
  now?: number;
}

/**
 * Runs every early-warning detector over each device's series and returns the
 * non-null findings. A detector simply returns null when the device's data does
 * not support (or does not warrant) an alert, so running them all is cheap and
 * safe.
 */
export function runDetectors(series: SeriesByDevice[], opts: RunnerOptions = {}): Finding[] {
  const now = opts.now ?? Date.now();
  const findings: Array<Finding | null> = [];

  for (const s of series) {
    findings.push(detectSignalDrift(s.deviceKind, s.deviceId, s.rxPower, { now }));
    findings.push(detectTemperatureDrift(s.deviceKind, s.deviceId, s.temperature, { now }));
    findings.push(detectFlapping(s.deviceKind, s.deviceId, s.statuses, { now }));
    findings.push(detectRebootStorm(s.deviceKind, s.deviceId, s.uptime, { now }));
    findings.push(detectBaselineAnomaly(s.deviceKind, s.deviceId, s.rxPower, { now }));
    findings.push(detectBaselineAnomaly(s.deviceKind, s.deviceId, s.temperature, { now }));
  }

  return findings.filter((f): f is Finding => f !== null);
}
