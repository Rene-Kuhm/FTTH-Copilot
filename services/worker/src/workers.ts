/**
 * The BullMQ consumers of the worker.
 *
 * One worker per queue of `@ftth-copilot/jobs`, wired to the handler
 * registry. The workers are the only part of this process that talk to
 * Redis; everything else reads their state to report it.
 *
 * The connection comes from `workerRedisConnectionOptions()`, which sets
 * `maxRetriesPerRequest: null` — BullMQ requires it for workers, because
 * their blocking reads must not be cut short by a client-side retry limit.
 */

import {
  QUEUE_NAMES,
  defineWorker,
  workerRedisConnectionOptions,
  type JobWorker,
  type QueueKey,
  type RedisConnectionOptions,
} from '@ftth-copilot/jobs';
import { JOB_HANDLERS } from './registry';
import type { QueueCounter, WorkerRuntime } from './health';

/** Jobs of a queue that run at the same time. Defaults to 1. */
export const DEFAULT_CONCURRENCY = 1;

/**
 * Grace period a worker gets to finish its current job while closing.
 *
 * A worker whose Redis connection never came up cannot finish anything and
 * would keep the close pending forever: the shutdown must not hang on a
 * broken dependency.
 */
export const SHUTDOWN_GRACE_MS = 10_000;

/** A booted fleet of workers. */
export interface WorkerFleet {
  /** Live state, read by the health/metrics server on every request. */
  readonly runtime: WorkerRuntime;
  /** The workers, one per queue. */
  readonly workers: readonly JobWorker<QueueKey>[];
  /** Closes every worker and releases its Redis connections. */
  close(): Promise<void>;
}

/** Options of `bootWorkers`. */
export interface BootWorkersOptions {
  /** Environment the Redis connection is read from. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Connection options. Defaults to `workerRedisConnectionOptions(env)`. */
  connection?: RedisConnectionOptions;
  /** Jobs of a queue running at the same time. Defaults to 1. */
  concurrency?: number;
  /** Called when a worker reports a connection or processing error. */
  onError?: (queue: string, error: Error) => void;
}

/**
 * Boots one worker per queue.
 *
 * The workers start consuming immediately — an empty registry is fine, the
 * queue is simply not doing any work yet.
 */
export function bootWorkers(options: BootWorkersOptions = {}): WorkerFleet {
  const env = options.env ?? process.env;
  const connection = options.connection ?? workerRedisConnectionOptions(env);
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;

  const startedAtMs = Date.now();
  const counters = new Map<string, QueueCounter>();
  const readyQueues = new Set<string>();
  const consumedQueues: string[] = [];
  const workers: JobWorker<QueueKey>[] = [];

  for (const key of Object.keys(QUEUE_NAMES) as QueueKey[]) {
    const queueName = QUEUE_NAMES[key];
    const counter: QueueCounter = { completed: 0, failed: 0 };
    counters.set(queueName, counter);
    consumedQueues.push(queueName);

    const worker = defineWorker(key, JOB_HANDLERS, { connection, concurrency });

    // 'ready' fires when the blocking connection is established. Until then
    // the worker cannot take any job, so the health report says degraded.
    worker.on('ready', () => {
      readyQueues.add(queueName);
    });
    worker.on('error', (error: Error) => {
      readyQueues.delete(queueName);
      options.onError?.(queueName, error);
    });
    worker.on('closed', () => {
      readyQueues.delete(queueName);
    });
    worker.on('completed', () => {
      counter.completed += 1;
    });
    worker.on('failed', () => {
      counter.failed += 1;
    });

    workers.push(worker);
  }

  const runtime: WorkerRuntime = {
    get queues(): readonly string[] {
      return [...consumedQueues];
    },
    get redisReady(): boolean {
      return workers.length > 0 && readyQueues.size === workers.length;
    },
    startedAtMs,
    counters,
  };

  return {
    runtime,
    workers,
    async close(): Promise<void> {
      await Promise.all(workers.map((worker) => closeWorker(worker)));
    },
  };
}

/**
 * Closes one worker, giving it a bounded grace period.
 *
 * The graceful close waits for the job in flight to finish. When Redis is
 * unreachable there is no job in flight and no connection to release, so the
 * wait would never end — the grace period bounds it and the process exits
 * anyway.
 */
async function closeWorker(worker: JobWorker<QueueKey>): Promise<void> {
  const closing = worker.close().catch(() => {
    // A worker that never connected has nothing to release.
  });

  let timer: NodeJS.Timeout | undefined;
  const grace = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, SHUTDOWN_GRACE_MS);
    timer.unref();
  });

  try {
    await Promise.race([closing, grace]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
