/**
 * Delegation to `@ftth-copilot/scheduler`.
 *
 * The recurring work (polling, firmware audit, FEC collection) left the
 * Next.js process: it now lives in a package the background worker can also
 * run, so the same code serves the in-process loops (until the
 * `BACKEND_MODE=worker` cut-over) and the queue jobs.
 *
 * This module keeps the web's public API: every export it had before is still
 * exported here, so no call site changes its import.
 */

export {
  advisoryLockKey,
  acquireSchedulerLock,
  __clearSchedulerState,
  tryStart,
  runScheduledPoll,
  runScheduledFirmwareAudit,
  runScheduledFecCollection,
  startPollingLoop,
  startFirmwareAuditLoop,
  startFecCollectionLoop,
} from '@ftth-copilot/scheduler';
