import { join } from 'node:path';
import { ingestEvents, type IngestEventInput } from '@ftth-copilot/soc';
import { DurableSpool, type SpoolEntry, type SpoolStats } from './spool';
import { EventDrainer, type BatchWriter } from './drainer';

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
    write: writeBatch,
    onBatchFailed: () => {
      drainFailures++;
    },
  });

  drainer.start();
}

/**
 * Writes a batch into Postgres.
 *
 * The `ingestId` of every entry travels with the payload: it is what makes a
 * replayed batch a no-op instead of a duplicated row.
 */
async function writeBatch(entries: SpoolEntry<DeviceEventPayload>[]): Promise<void> {
  await ingestEvents(
    entries.map((entry) => ({ ...entry.payload, ingestId: entry.ingestId })),
  );
}

/**
 * Default number of batches a single drain runs.
 *
 * A drain must not run forever: the events that do not fit wait on disk for
 * the next drain.
 */
export const DEFAULT_DRAIN_MAX_BATCHES = 20;

/** Options of a drain. */
export interface DrainSpoolOptions {
  /** Entries per batch. Defaults to the drainer's own default. */
  batchSize?: number;
  /** Batches per drain. Defaults to `DEFAULT_DRAIN_MAX_BATCHES`. */
  maxBatches?: number;
  /**
   * Writer of a batch. Defaults to the Postgres writer (`ingestEvents`).
   * Injecting it is what lets a drain be tested without a database.
   */
  write?: BatchWriter<DeviceEventPayload>;
}

/** Outcome of a drain. */
export interface DrainSpoolResult {
  /** Events stored in the database. */
  drained: number;
  /** Events that could not be stored (the batch failed). */
  failed: number;
  /** Events moved to the dead-letter file. */
  quarantined: number;
  /** Batches read from the spool. */
  batches: number;
  /** True when the spool still holds events after the drain. */
  backlogRemains: boolean;
}

/**
 * Drains the durable spool into the store, in batches.
 *
 * This is the entry point of the queue job: the worker drains the spool from
 * a job, never in process. The drain reads until the spool is empty or the
 * bounded number of batches is reached, so a job always finishes.
 *
 * It is a no-op on an empty spool: the enqueue is per event, so the first
 * job usually drains everything and the rest find nothing to do.
 */
export async function drainSpool(options: DrainSpoolOptions = {}): Promise<DrainSpoolResult> {
  const spool = getSpool();
  const maxBatches = options.maxBatches ?? DEFAULT_DRAIN_MAX_BATCHES;

  const drainer = new EventDrainer<DeviceEventPayload>({
    spool,
    write: options.write ?? writeBatch,
    batchSize: options.batchSize,
  });

  const result: DrainSpoolResult = {
    drained: 0,
    failed: 0,
    quarantined: 0,
    batches: 0,
    backlogRemains: false,
  };

  for (let batch = 0; batch < maxBatches; batch++) {
    const outcome = await drainer.drainOnce();

    // The backoff says to hold off: the store is probably down.
    if (outcome.deferred) break;
    // Nothing left to read.
    if (outcome.drained === 0 && outcome.failed === 0) break;

    result.batches += 1;
    result.drained += outcome.drained;
    result.failed += outcome.failed;
    result.quarantined += outcome.quarantined;

    // The store refused the batch: the events stay on disk and the caller
    // retries later. Draining on would only hammer a database that is down.
    if (outcome.failed > 0) break;
  }

  result.backlogRemains = spool.stats().backlog > 0;
  return result;
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