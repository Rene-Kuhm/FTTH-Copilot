/**
 * Live state of the ingest path.
 *
 * The worker is the process that owns the syslog and the SNMP sockets and
 * the durable spool, so its health report has to say whether the sockets are
 * bound and how much is waiting to be stored. All of it comes from the
 * packages that own them: the health registry of `@ftth-copilot/scheduler`
 * and the stats of `@ftth-copilot/ingest`.
 *
 * Nothing is cached here: the state is read on every request, so the report
 * always reflects the current state.
 */

import { eventIngestStats } from '@ftth-copilot/ingest';
import { snapshotHealth } from '@ftth-copilot/scheduler';
import type { IngestRuntimeState } from './health';

/**
 * Reads the state of the syslog receiver, of the SNMP receiver and of the
 * durable spool.
 */
export function readIngestState(): IngestRuntimeState {
  const syslog = snapshotHealth()['syslog'];
  const snmp = snapshotHealth()['snmp'];
  const ingest = eventIngestStats();

  return {
    syslogBound: syslog?.bound === true,
    syslogExpected: syslog?.expected === true,
    syslogLastError: syslog?.lastError ?? null,
    snmpBound: snmp?.bound === true,
    snmpExpected: snmp?.expected === true,
    snmpLastError: snmp?.lastError ?? null,
    backlog: ingest.backlog,
    dropped: ingest.dropped,
    deadLettered: ingest.deadLettered,
    rateLimited: ingest.rateLimited,
  };
}
