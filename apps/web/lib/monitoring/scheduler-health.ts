/**
 * Delegation to `@ftth-copilot/scheduler`.
 *
 * The health registry of the scheduled loops left the Next.js process: it now
 * lives in the same package as the loops themselves, so the worker and the web
 * read the same state model.
 *
 * This module keeps the web's public API: every export it had before is still
 * exported here, so `/api/health`, `/api/metrics` and the syslog/SNMP
 * receivers keep importing from the same path.
 */

export {
  markExpected,
  markNotExpected,
  recordSuccess,
  recordError,
  recordSyslogBound,
  recordSnmpBound,
  snapshotHealth,
  detectHangedLoops,
  overallHealthy,
  __resetSchedulerHealth,
} from '@ftth-copilot/scheduler';

export type { SchedulerName, ServiceHealth } from '@ftth-copilot/scheduler';
