import type { JobsOptions } from 'bullmq';

/**
 * Options accepted when enqueuing a job.
 *
 * Kept in its own module because it is pure: the mapping to BullMQ's option
 * shape can be tested without a Redis, and callers can import the type
 * without pulling the queue runtime in.
 */
export interface EnqueueOptions {
  /**
   * Stable job id. BullMQ refuses to add a second job with an id that
   * already exists, so this collapses duplicates. Must not contain ':'.
   */
  jobId?: string;
  /** Delay before the job becomes available. */
  delayMs?: number;
  /** How many times the job is attempted before it is dead-lettered. */
  attempts?: number;
  /** Backoff between attempts. */
  backoff?: { type: 'exponential' | 'fixed'; delay: number };
  /** Whether completed jobs are removed, and how many are kept. */
  removeOnComplete?: boolean | number;
  /**
   * Whether failed jobs are removed, and how many are kept.
   *
   * Keeping them is what makes the dead-letter queue inspectable, so the
   * default keeps the last failures instead of dropping them.
   */
  removeOnFail?: boolean | number;
}

/**
 * Converts the package's option shape into BullMQ's.
 *
 * Only the options that were actually provided are forwarded, so BullMQ's
 * own defaults (and not a pile of `undefined`s) decide the rest.
 */
export function toJobsOptions(options: EnqueueOptions = {}): JobsOptions {
  const jobsOptions: JobsOptions = {};

  if (options.jobId !== undefined) jobsOptions.jobId = options.jobId;
  if (options.delayMs !== undefined) jobsOptions.delay = options.delayMs;
  if (options.attempts !== undefined) jobsOptions.attempts = options.attempts;
  if (options.backoff !== undefined) jobsOptions.backoff = options.backoff;
  if (options.removeOnComplete !== undefined) jobsOptions.removeOnComplete = options.removeOnComplete;
  if (options.removeOnFail !== undefined) jobsOptions.removeOnFail = options.removeOnFail;

  return jobsOptions;
}
