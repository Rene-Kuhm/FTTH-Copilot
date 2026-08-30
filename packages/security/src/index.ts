export { parseSyslogMessage, type ParsedSyslog } from './syslog';
export { classifyEvent, type EventCategory } from './classify';
export type { SecurityEvent, SecurityFinding, SecurityFindingKind } from './types';
export {
  detectBruteForce,
  detectAccessAfterFailures,
  detectConfigChange,
  type DetectorOptions,
} from './detectors';
