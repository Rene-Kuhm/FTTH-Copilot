import { Queue } from 'bullmq';
import {
  QUEUE_NAMES,
  type JobPayload,
  type QueueData,
  type QueueJobMap,
  type QueueKey,
} from './definitions';
import type { RedisConnectionOptions } from './connection';
import { toJobsOptions, type EnqueueOptions } from './options';

/**
 * Producer side of the queue.
 *
 * Two ways to put work on a queue:
 *
 *   - `enqueueJob` for one-shot work. It accepts a stable `jobId`, which is
 *     how a retried or duplicated request is collapsed into a single job.
 *   - `scheduleRecurring` for loops. It uses BullMQ's Job Schedulers, the
 *     v6 replacement for the removed `repeat` option: the upsert is
 *     idempotent per scheduler id, so N producers never create N schedules.
 */

/**
 * A queue bound to the logical queue it was opened for.
 *
 * The payload type of the queue is the concrete union of every job payload:
 * BullMQ v6 derives the accepted job name from it, and a generic payload
 * would leave that derivation deferred. The per-job payload type is enforced
 * by `enqueueJob`, which is where callers actually see it.
 *
 * The optional `__queueKey` is a phantom marker: it ties the queue to the
 * logical queue it belongs to, so `enqueueJob` only accepts the job name
 * that queue is for.
 */
export type JobQueue<Q extends QueueKey> = Queue<JobPayload, unknown, string> & {
  readonly __queueKey?: Q;
};

/** Job returned by `enqueueJob`. */
export type EnqueuedJob<Q extends QueueKey> = import('bullmq').Job<
  QueueData<Q>,
  unknown,
  string
>;

/**
 * Opens a queue for producing jobs.
 *
 * The caller owns the returned queue and must close it when it is done;
 * BullMQ keeps a Redis connection open until then.
 */
export function createJobQueue<Q extends QueueKey>(
  key: Q,
  connection: RedisConnectionOptions,
): JobQueue<Q> {
  const queue = new Queue<JobPayload, unknown, string>(QUEUE_NAMES[key], { connection });
  return queue as JobQueue<Q>;
}

/**
 * Enqueues a one-shot job.
 *
 * Pass a stable `jobId` (see `windowJobId` / `ingestDrainJobId`) when the
 * same work must not run twice — a retry, a double click, or a second
 * producer racing the first.
 */
export async function enqueueJob<Q extends QueueKey>(
  queue: JobQueue<Q>,
  name: QueueJobMap[Q],
  data: QueueData<Q>,
  options: EnqueueOptions = {},
): Promise<EnqueuedJob<Q>> {
  const job = await queue.add(name, data, toJobsOptions(options));
  // The queue carries the union of every payload; the job carries the
  // payload of its own name, which `data` already guarantees at the call
  // site. The assertion restores that narrower view for the caller.
  return job as EnqueuedJob<Q>;
}

/** A recurring schedule for a loop. */
export type RecurringSchedule<Q extends QueueKey> = {
  /**
   * Stable id of the schedule. `upsertJobScheduler` is idempotent per id, so
   * several producers calling this never create two schedules.
   */
  schedulerId: string;
  /** Period of the loop, in milliseconds. */
  everyMs: number;
  /**
   * When the schedule starts, in epoch milliseconds.
   *
   * BullMQ computes the first tick from this value: it is the instant of the
   * first job, and every later tick follows the period from there. Without
   * it the first tick is produced immediately, which is not always what a
   * loop wants — the in-process loops waited a few seconds after boot before
   * their first run.
   *
   * The unit matters: BullMQ reads the value as a number of milliseconds, so
   * a `Date` object (which serializes to a string) would be ignored and the
   * first tick would fire immediately anyway.
   */
  startDateMs?: number;
  /** Job name, always the one this queue accepts. */
  name: QueueJobMap[Q];
  /** Job payload. */
  data: QueueData<Q>;
  /** Retry, backoff and retention options for every produced job. */
  options?: EnqueueOptions;
};

/**
 * Creates or updates a recurring schedule.
 *
 * BullMQ v6 removed the `repeat` option and the `Repeat` class; Job
 * Schedulers are the replacement. Two properties matter here:
 *
 *   - the upsert is idempotent per `schedulerId`, so the schedule cannot be
 *     duplicated by running several workers or several producers;
 *   - each produced job is handed to exactly one worker, so a tick is not
 *     executed twice when the fleet scales out.
 */
export async function scheduleRecurring<Q extends QueueKey>(
  queue: JobQueue<Q>,
  schedule: RecurringSchedule<Q>,
): Promise<void> {
  // A scheduled job cannot carry a job id (BullMQ strips it from the
  // scheduler template) and cannot be delayed individually: the schedule
  // itself decides when it fires.
  const { jobId: _jobId, delay: _delay, ...templateOptions } = toJobsOptions(
    schedule.options ?? {},
  );

  await queue.upsertJobScheduler(
    schedule.schedulerId,
    toRepeatOptions(schedule),
    {
      name: schedule.name,
      data: schedule.data,
      opts: templateOptions,
    },
  );
}

/**
 * Converts a recurring schedule into BullMQ's repeat options.
 *
 * Exported for tests: the mapping is the part of the producer that can be
 * wrong without any Redis involved.
 */
export function toRepeatOptions(schedule: {
  everyMs: number;
  startDateMs?: number;
}): { every: number; startDate?: number } {
  const repeatOptions: { every: number; startDate?: number } = { every: schedule.everyMs };
  if (schedule.startDateMs !== undefined) repeatOptions.startDate = schedule.startDateMs;
  return repeatOptions;
}
