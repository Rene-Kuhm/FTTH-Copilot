/**
 * Delegation to `@ftth-copilot/scheduler`.
 *
 * The recurring work (polling, firmware audit, FEC collection) left the
 * Next.js process: it now lives in a package the background worker runs
 * from the durable queue. This module keeps the web's public API for the
 * pieces the web still uses, so no call site changes its import.
 *
 * The in-process loop starters are gone: the worker is the only owner of
 * the background work, and a second copy of a loop would poll the NMS twice
 * and bind the same UDP socket.
 */

export {
  advisoryLockKey,
  acquireSchedulerLock,
  __clearSchedulerState,
  tryStart,
  runScheduledPoll,
  runScheduledFirmwareAudit,
  runScheduledFecCollection,
} from '@ftth-copilot/scheduler';
