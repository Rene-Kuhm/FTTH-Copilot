import { join } from 'node:path';
import { ingestEvents, type IngestEventInput } from '@ftth-copilot/soc';
import { DurableSpool, type SpoolEntry, type SpoolStats } from './event-spool';
import { EventDrainer } from './event-drainer';

/**
 * Durable ingest path shared by the syslog and SNMP receivers.
 *
 * The receiver hot path only appends to disk; a drainer moves records into
 * Postgres in batches. A database outage therefore delays persistence instead
 * of discarding the event, which is the requirement for NOC telemetry.
 */

export type DeviceEventPayload = Omit<IngestEventInput, 'ingestId'>;

export interface EventIngestStats extends SpoolStats {
  drainFailures: number;
  quarantinedTotal: number;
  /** Events discarded by the receiver's own rate limit before spooling. */
  rateLimited: number;
}

/**
 * Spool location. Kept outside the app tree because it must survive a
 * redeploy: losing it would lose buffered events.
 */
function spoolDir(): string {
  return process.env['EVENT_SPOOL_DIR']?.trim() || join(process.cwd(), '.spool');
}

let spool: DurableSpool<DeviceEventPayload> | null = null;
let drainer: EventDrainer<DeviceEventPayload> | null = null;
let drainFailures = 0;
let rateLimited = 0;

/**
 * Count an event the receiver refused before it reached the spool.
 *
 * Rate limiting still protects the database from a burst, but a refused
 * datagram is a lost datagram. Counting it keeps that loss observable.
 */
export function recordDroppedEvent(): void {
  rateLimited++;
}

/**
 * Queue one received event durably.
 *
 * Returns the assigned id, or null when the spool refused the record because
 * it hit the hard size limit. A throw means the write itself failed, which the
 * caller must surface: the datagram is already gone from the network.
 */
export function spoolEvent(payload: DeviceEventPayload): string | null {
  return getSpool().append(payload);
}

function getSpool(): DurableSpool<DeviceEventPayload> {
  if (spool === null) spool = new DurableSpool<DeviceEventPayload>({ dir: spoolDir() });
  return spool;
}

/** Start the background drainer. Safe to call once per process. */
export function startEventDrainer(): void {
  if (drainer !== null) return;

  drainer = new EventDrainer<DeviceEventPayload>({
    spool: getSpool(),
    write: async (entries: SpoolEntry<DeviceEventPayload>[]) => {
      await ingestEvents(
        entries.map((entry) => ({ ...entry.payload, ingestId: entry.ingestId })),
      );
    },
    onBatchFailed: () => {
      drainFailures++;
    },
  });

  drainer.start();
}

export function stopEventDrainer(): void {
  drainer?.stop();
  drainer = null;
  spool?.close();
  spool = null;
}

export function eventIngestStats(): EventIngestStats {
  const spoolStats = spool?.stats() ?? {
    backlog: 0,
    dropped: 0,
    corrupt: 0,
    deadLettered: 0,
    bytes: 0,
  };

  return {
    ...spoolStats,
    drainFailures,
    quarantinedTotal: spoolStats.deadLettered,
    rateLimited,
  };
}

/** Test seam: inject a spool without touching the module singleton. */
export function __setSpoolForTests(next: DurableSpool<DeviceEventPayload> | null): void {
  spool = next;
}