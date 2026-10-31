import { Worker, type Job } from 'bullmq';
import {
  QUEUE_NAMES,
  type JobName,
  type JobPayload,
  type JobPayloadMap,
  type QueueKey,
} from './definitions';
import type { RedisConnectionOptions } from './connection';

/**
 * Consumer side of the queue.
 *
 * The worker is an execution host, not a domain component: it receives a job
 * and calls a package function. Every handler it registers is the only place
 * where a job name turns into work.
 */

/** Runs one job. */
export type JobHandler<N extends JobName> = (
  data: JobPayloadMap[N],
  job: Job<JobPayloadMap[N], unknown, string>,
) => Promise<unknown>;

/**
 * The handlers of a worker, keyed by job name.
 *
 * A name with no handler is a wiring bug, not a transient failure: the
 * worker throws so BullMQ retries the job and eventually dead-letters it
 * instead of silently dropping the work.
 */
export type JobHandlers = Partial<{ [N in JobName]: JobHandler<N> }>;

/** A worker bound to the logical queue it consumes. */
export type JobWorker<Q extends QueueKey> = Worker<JobPayload, unknown, string> & {
  readonly __queueKey?: Q;
};

/** Options for a worker. */
export interface WorkerOptions {
  /** Connection options; workers need `maxRetriesPerRequest: null`. */
  connection: RedisConnectionOptions;
  /** How many jobs of this queue run at the same time. Defaults to 1. */
  concurrency?: number;
}

/**
 * Builds a worker for a queue.
 *
 * The worker dispatches by job name.
 */
export function defineWorker<Q extends QueueKey>(
  queue: Q,
  handlers: JobHandlers,
  options: WorkerOptions,
): JobWorker<Q> {
  // The handler map is keyed by job name, but TypeScript cannot correlate
  // `job.name` with the handler's payload type while the worker is generic.
  // The runtime lookup below is that correlation; this cast is the price.
  const lookup = handlers as unknown as Record<
    string,
    (data: unknown, job: Job<unknown, unknown, string>) => Promise<unknown>
  >;

  const worker = new Worker<JobPayload, unknown, string>(
    QUEUE_NAMES[queue],
    async (job) => {
      const handler = lookup[job.name];
      if (!handler) {
        throw new Error(`No handler registered for job '${job.name}' on queue '${queue}'`);
      }
      return handler(job.data, job as unknown as Job<unknown, unknown, string>);
    },
    {
      connection: options.connection,
      concurrency: options.concurrency ?? 1,
    },
  );

  return worker as JobWorker<Q>;
}
