/**
 * Delegation to `@ftth-copilot/ingest`.
 *
 * The durable ingest path (the shared spool, its writer and the in-process
 * drainer) left the Next.js process: the worker now owns the socket and
 * drains through the durable job queue, while the web keeps using the same
 * code in embedded mode.
 *
 * This module keeps the web's public API: every export it had before is still
 * exported here, so every importer of `@/lib/monitoring/event-ingest` keeps
 * working unchanged.
 */

export {
  __setSpoolForTests,
  eventIngestStats,
  recordDroppedEvent,
  spoolEvent,
  startEventDrainer,
  stopEventDrainer,
} from '@ftth-copilot/ingest';
export type { DeviceEventPayload, EventIngestStats } from '@ftth-copilot/ingest';
