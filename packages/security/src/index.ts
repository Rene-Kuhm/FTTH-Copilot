export { parseSyslogMessage, type ParsedSyslog } from './syslog';
export { classifyEvent, type EventCategory } from './classify';
export {
  truncateSyslogMessage,
  createRateWindowCounter,
  DEFAULT_MAX_SYSLOG_MESSAGE_LENGTH,
  type RateWindowCounter,
  type RateWindowCounterOptions,
} from './syslog-guard';
export type { SecurityEvent, SecurityFinding, SecurityFindingKind } from './types';
export {
  detectBruteForce,
  detectAccessAfterFailures,
  detectConfigChange,
  type DetectorOptions,
} from './detectors';
export {
  detectVulnerableFirmware,
  type DeviceFirmware,
  type FirmwareDetectorOptions,
} from './firmware';
export {
  detectTrafficAnomaly,
  type TrafficSample,
  type DeviceTraffic,
  type TrafficDetectorOptions,
} from './traffic';
