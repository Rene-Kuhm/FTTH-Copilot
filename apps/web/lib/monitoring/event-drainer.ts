/**
 * Delegation to `@ftth-copilot/ingest`.
 *
 * The drainer left the Next.js process along with the spool it drains: the
 * worker runs the same machinery from a queue job.
 *
 * This module keeps the web's public API: every export it had before is still
 * exported here, so every importer of `@/lib/monitoring/event-drainer` keeps
 * working unchanged.
 */

export { EventDrainer } from '@ftth-copilot/ingest';
export type { BatchWriter, DrainResult, EventDrainerOptions } from '@ftth-copilot/ingest';
