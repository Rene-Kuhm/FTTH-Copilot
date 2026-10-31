/**
 * `@ftth-copilot/ingest` — the durable ingest path, outside the web.
 *
 * This package owns the reception of device events and their persistence:
 *
 *   - `spool.ts` — the durable, append-only spool. The hot path only writes to
 *     disk, so a database outage delays persistence instead of losing events.
 *   - `drainer.ts` — the batch drainer: reads the spool, writes it to the
 *     store, retries with backoff and quarantines what keeps failing.
 *   - `ingest.ts` — the shared spool instance and the writer that persists a
 *     batch into Postgres.
 *   - `syslog-receiver.ts` — the UDP syslog receiver. It parses, classifies
 *     and spools every datagram; it never writes to the database itself.
 *
 * The code moved here verbatim from `apps/web/lib/monitoring/*`: the web
 * still uses it (embedded mode) and re-exports it, while the worker binds the
 * socket and drains the spool through the durable job queue.
 */

export {
  DurableSpool,
  type DurableSpoolOptions,
  type SpoolEntry,
  type SpoolStats,
} from './spool';

export {
  EventDrainer,
  type BatchWriter,
  type DrainResult,
  type EventDrainerOptions,
} from './drainer';

export {
  __setSpoolForTests,
  DEFAULT_DRAIN_MAX_BATCHES,
  drainSpool,
  eventIngestStats,
  recordDroppedEvent,
  spoolEvent,
  startEventDrainer,
  stopEventDrainer,
  type DeviceEventPayload,
  type DrainSpoolOptions,
  type DrainSpoolResult,
  type EventIngestStats,
} from './ingest';

export { startSyslogReceiver, type SyslogReceiverOptions } from './syslog-receiver';
