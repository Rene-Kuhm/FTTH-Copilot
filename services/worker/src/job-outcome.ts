/**
 * What the worker learns from a job that ended.
 *
 * Two questions, and both of them come from the same event:
 *
 *   - **how long did it take** — the duration of the attempt, measured with
 *     the timestamps BullMQ puts on the job (`processedOn` when it went
 *     active, `finishedOn` when it ended);
 *   - **was it retried** — BullMQ retries a failed job while it has attempts
 *     left, and gives up when they run out. The attempt that gives up is the
 *     one that lands in the queue's dead-letter.
 *
 * The shape of the job is spelled out instead of importing BullMQ's types, so
 * the decisions can be tested without a Redis instance.
 */

/** The part of a BullMQ job this module reads. */
export interface JobTiming {
  /** When the job went active, in epoch milliseconds. */
  readonly processedOn?: number;
  /** When the job ended, in epoch milliseconds. */
  readonly finishedOn?: number;
}

/** The part of a failure this module reads. */
export interface JobFailure {
  /** Attempts made so far, including the one that failed. */
  readonly attemptsMade?: number;
  /** Attempts the job is allowed to make in total. */
  readonly attempts?: number;
  /** Name of the error, to spot the unrecoverable ones. */
  readonly errorName?: string;
}

/** What the worker learns from a job that ended. */
export interface JobOutcome {
  /** Duration of the attempt in seconds, or `null` when it cannot be measured. */
  readonly durationSeconds: number | null;
  /** Whether BullMQ will run this job again. */
  readonly willRetry: boolean;
}

/**
 * Reads the outcome of a job that ended.
 *
 * A job that never started (`processedOn` missing) has no duration: saying
 * it took zero seconds would put a fake sample in the histogram and drag the
 * p95 of the queue down.
 */
export function readJobOutcome(job: JobTiming, failure?: JobFailure): JobOutcome {
  return {
    durationSeconds: measureDuration(job),
    willRetry: willRetry(failure),
  };
}

/** Duration of the attempt in seconds, or `null` when it cannot be measured. */
function measureDuration(job: JobTiming): number | null {
  const started = job.processedOn;
  const finished = job.finishedOn;
  if (typeof started !== 'number' || typeof finished !== 'number') return null;
  if (!Number.isFinite(started) || !Number.isFinite(finished)) return null;

  const seconds = (finished - started) / 1000;
  if (seconds < 0) return null;
  return seconds;
}

/**
 * Whether BullMQ will run the job again.
 *
 * BullMQ increments `attemptsMade` before it emits `failed`, and it retries
 * while `attemptsMade < attempts`. An unrecoverable error is never retried,
 * no matter how many attempts are left.
 */
function willRetry(failure?: JobFailure): boolean {
  if (!failure) return false;

  const attemptsMade = failure.attemptsMade ?? 0;
  const attempts = failure.attempts ?? 1;
  if (attemptsMade >= attempts) return false;
  if (failure.errorName === 'UnrecoverableError') return false;

  return true;
}
