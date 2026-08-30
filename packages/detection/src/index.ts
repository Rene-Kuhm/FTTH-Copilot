export * from './types';
export { median, mean, mad, fitTrend, DAY_MS, type TrendFit } from './stats';
export {
  predictThresholdCrossing,
  type CrossingOptions,
  type CrossingPrediction,
} from './trend';
export { detectSignalDrift, type SignalDriftOptions } from './signal-drift';
export {
  detectTemperatureDrift,
  type TemperatureDriftOptions,
} from './temperature-drift';
export { detectFlapping, type FlappingOptions } from './flapping';
export { detectRebootStorm, type RebootStormOptions } from './reboots';
export { detectBaselineAnomaly, type AnomalyOptions } from './anomaly';
export { detectFecDegradation, type FecDegradationOptions } from './fec';
export {
  detectOpticalDegradation,
  type OpticalDegradationOptions,
} from './optical';
