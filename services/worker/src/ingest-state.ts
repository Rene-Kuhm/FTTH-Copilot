/**
 * Live state of the ingest path.
 *
 * The worker is the process that owns the syslog socket and the durable
 * spool, so its health report has to say whether the socket is bound and how
 * much is waiting to be stored. Both come from the packages that own them:
 * the health registry of `@ftth-copilot/scheduler` and the stats of
 * `@ftth-copilot/ingest`.
 *
 * Nothing is cached here: the state is read on every request, so the report
 * always reflects the current state.
 */

import { eventIngestStats } from '@ftth-copilot/ingest';
import { snapshotHealth } from '@ftth-copilot/scheduler';
import type { IngestRuntimeState } from './health';

/**
 * Reads the state of the syslog receiver and of the durable spool.
 */
export function readIngestState(): IngestRuntimeState {
  const syslog = snapshotHealth()['syslog'];
  const ingest = eventIngestStats();

  return {
    syslogBound: syslog?.bound === true,
    syslogExpected: syslog?.expected === true,
    syslogLastError: syslog?.lastError ?? null,
    backlog: ingest.backlog,
    dropped: ingest.dropped,
    deadLettered: ingest.deadLettered,
    rateLimited: ingest.rateLimited,
  };
}
