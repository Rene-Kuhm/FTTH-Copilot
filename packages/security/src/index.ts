export { parseSyslogMessage, type ParsedSyslog } from './syslog';
export { classifyEvent, type EventCategory } from './classify';
export {
  buildSyslogMessage,
  buildSocScenarioMessages,
  type SyslogMessageParts,
  type SocScenarioOptions,
} from './syslog-build';
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
export { extractSourceIpFromMessage } from './source-ip';
export {
  detectTrafficAnomaly,
  type TrafficSample,
  type DeviceTraffic,
  type TrafficDetectorOptions,
} from './traffic';
export {
  DEFAULT_ROLE_MAP_ENTRIES,
  RBAC_ROLE_RANK,
  parseRoleMap,
  mapGroupsToRole,
  type RbacRole,
  type AppRole,
} from './auth-roles';
