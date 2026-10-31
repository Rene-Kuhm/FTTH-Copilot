/**
 * Delegation to `@ftth-copilot/ingest`.
 *
 * The durable spool left the Next.js process: it is now shared by the web
 * (embedded mode) and by the worker, which owns the socket and the drain job.
 *
 * This module keeps the web's public API: every export it had before is still
 * exported here, so every importer of `@/lib/monitoring/event-spool` keeps
 * working unchanged.
 */

export { DurableSpool } from '@ftth-copilot/ingest';
export type { DurableSpoolOptions, SpoolEntry, SpoolStats } from '@ftth-copilot/ingest';
