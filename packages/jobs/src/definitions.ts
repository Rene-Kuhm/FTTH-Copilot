/**
 * Typed vocabulary of the durable job queue.
 *
 * This module is the single source of truth for queue names, job names and
 * job payloads. The web (producer) and the worker (consumer) both import it,
 * so a rename can never land on one side only.
 *
 * The mapping is deliberately narrow: one logical queue per kind of background
 * work, and one job name per queue. That keeps the worker a dumb execution
 * host — it translates a job into a call to a package function and owns no
 * domain logic.
 */

/**
 * Logical queue keys mapped to the physical Redis queue name.
 *
 * BullMQ rejects queue names containing ':' (it is its own key separator),
 * so the physical names use a dash.
 */
export const QUEUE_NAMES = {
  poll: 'ftth-poll',
  firmware: 'ftth-firmware',
  fec: 'ftth-fec',
  ingest: 'ftth-ingest',
  investigation: 'ftth-investigation',
  investigationSweep: 'ftth-investigation-sweep',
} as const;

/** Logical key of a queue. */
export type QueueKey = keyof typeof QUEUE_NAMES;

/** Job names, one per queue. */
export const JOB_NAMES = {
  pollConnections: 'poll-connections',
  firmwareAudit: 'firmware-audit',
  fecCollection: 'fec-collection',
  ingestDrain: 'ingest-drain',
  investigationRun: 'investigation-run',
  investigationSweep: 'investigation-sweep',
} as const;

/**
 * Poll one NMS connection set: sample, persist, detect and notify.
 * `connectionId` narrows the tick to a single connection.
 */
export interface PollConnectionsPayload {
  connectionId?: string;
}

/**
 * Audit live firmware versions against the vulnerability allowlist.
 * `connectionId` narrows the audit to a single connection.
 */
export interface FirmwareAuditPayload {
  connectionId?: string;
}

/**
 * Collect optical/FEC telemetry for a deterministic slice of ONUs.
 * `tickIndex` is the fan-out slice index; the worker recomputes it from the
 * clock when it is absent.
 */
export interface FecCollectionPayload {
  tickIndex?: number;
}

/**
 * Drain buffered events from the durable spool into Postgres.
 *
 * `source` selects which spool to drain. `ingestId` is the id the spool
 * assigned to the event, and is what makes the drain at-least-once: the job
 * id is derived from it, so the same event is never ingested twice even if
 * the job is retried.
 */
export interface IngestDrainPayload {
  source: 'syslog' | 'snmp';
  tenantId?: string;
  ingestId?: string;
}

/**
 * Run one attempt of an incident investigation.
 *
 * `versionId` identifies the attempt: the run row is reused across attempts,
 * and only the attempt whose `versionId` is the run's `currentVersionId` may
 * close it. The job id derives from `runId` + `versionId`, so the same attempt
 * is never executed twice. `tenantId` is re-checked against the incident by
 * the worker before anything runs.
 */
export interface InvestigationRunPayload {
  tenantId: string;
  incidentId: string;
  runId: string;
  versionId: string;
  /** User who requested the investigation. */
  userId: string;
  windowDays?: number;
  /** When the attempt started, in epoch milliseconds. */
  startedAtMs: number;
}

/** Expire the investigation attempts that stayed `pending` past their TTL. */
export interface InvestigationSweepPayload {
  ttlMs?: number;
}

/** Payload type of every known job name. */
export interface JobPayloadMap {
  [JOB_NAMES.pollConnections]: PollConnectionsPayload;
  [JOB_NAMES.firmwareAudit]: FirmwareAuditPayload;
  [JOB_NAMES.fecCollection]: FecCollectionPayload;
  [JOB_NAMES.ingestDrain]: IngestDrainPayload;
  [JOB_NAMES.investigationRun]: InvestigationRunPayload;
  [JOB_NAMES.investigationSweep]: InvestigationSweepPayload;
}

/** Every known job name. */
export type JobName = keyof JobPayloadMap;

/**
 * The payload of any job this package produces.
 *
 * Concrete on purpose: BullMQ v6 derives the accepted job name from the
 * queue's data type (`ExtractNameType`), and that derivation stays deferred
 * when the data type is a generic indexed access — which TypeScript then
 * refuses to use in some positions. A concrete union keeps the queue type
 * simple; the per-job payload type is enforced by `enqueueJob` instead.
 */
export type JobPayload = JobPayloadMap[JobName];

/** Which job name belongs to which queue. */
export interface QueueJobMap {
  poll: typeof JOB_NAMES.pollConnections;
  firmware: typeof JOB_NAMES.firmwareAudit;
  fec: typeof JOB_NAMES.fecCollection;
  ingest: typeof JOB_NAMES.ingestDrain;
  investigation: typeof JOB_NAMES.investigationRun;
  investigationSweep: typeof JOB_NAMES.investigationSweep;
}

/** Payload carried by the jobs of a given queue. */
export type QueueData<Q extends QueueKey> = JobPayloadMap[QueueJobMap[Q]];

/** Job name accepted by a given queue. */
export type JobNameFor<Q extends QueueKey> = QueueJobMap[Q];

/**
 * BullMQ rejects a custom job id containing ':' ("Custom Id cannot contain
 * :"), so every id this package produces is built from a sanitized scope.
 */
export function sanitizeJobScope(scope: string): string {
  return scope.replace(/[^a-zA-Z0-9_-]/g, '-');
}

/**
 * Stable job id for a given window of time.
 *
 * Two producers that compute the id for the same window produce the same
 * string, and BullMQ refuses to add a second job with an id that already
 * exists — so the window is executed once, no matter how many producers or
 * workers are running.
 *
 * @param scope   What the job is (usually the job name).
 * @param windowMs Width of the window in milliseconds.
 * @param at      Timestamp inside the window. Defaults to now.
 */
export function windowJobId(scope: string, windowMs: number, at: number = Date.now()): string {
  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    throw new Error(`windowJobId requires a positive window size, received ${windowMs}`);
  }
  return `${sanitizeJobScope(scope)}-${Math.floor(at / windowMs)}`;
}

/**
 * Job id for a single buffered event.
 *
 * The spool assigns an `ingestId` when it buffers the event; deriving the job
 * id from it is what makes the drain at-least-once instead of at-least-twice:
 * a retried job keeps the same id and BullMQ will not enqueue it twice.
 */
export function ingestDrainJobId(source: string, ingestId: string): string {
  if (ingestId.trim().length === 0) {
    throw new Error('ingestDrainJobId requires a non-empty ingest id');
  }
  return `${sanitizeJobScope(`ingest-drain-${source}`)}-${sanitizeJobScope(ingestId)}`;
}

/**
 * Job id of one investigation attempt.
 *
 * Derived from the run and the attempt, so a double click, a retried request
 * or a second producer can never enqueue the same attempt twice.
 */
export function investigationJobId(runId: string, versionId: string): string {
  if (runId.trim().length === 0 || versionId.trim().length === 0) {
    throw new Error('investigationJobId requires a non-empty run id and version id');
  }
  return `investigation-${sanitizeJobScope(runId)}-${sanitizeJobScope(versionId)}`;
}

/**
 * Stable id of the scheduler that produces a recurring job.
 *
 * `upsertJobScheduler` is idempotent per id, so calling it from several
 * processes never creates two schedules for the same loop.
 */
export function recurringSchedulerId(scope: string): string {
  return `scheduler-${sanitizeJobScope(scope)}`;
}
