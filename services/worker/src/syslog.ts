/**
 * The syslog receiver of the worker.
 *
 * The worker owns the UDP socket now: it binds it, spools every datagram
 * into the durable spool and enqueues the job that drains the spool into
 * Postgres. The web does the same in embedded mode, through the same
 * package.
 *
 * Two properties matter here:
 *
 *   - the spool write happens first and is durable. The enqueue is a
 *     notification, not the delivery: if Redis is down the event is already
 *     safe on disk, the failure is surfaced and the receiver keeps running.
 *   - the job id is stable (`ingestDrainJobId`), so the same event is never
 *     ingested twice, even if the job is retried.
 */

import {
  JOB_NAMES,
  createJobQueue,
  enqueueJob,
  ingestDrainJobId,
  redisConnectionOptions,
  type JobQueue,
  type RedisConnectionOptions,
} from '@ftth-copilot/jobs';
import { startSyslogReceiver } from '@ftth-copilot/ingest';
import { recordError as recordSchedulerError } from '@ftth-copilot/scheduler';

/**
 * Retry policy of the drain job.
 *
 * A failed drain leaves the events on disk, so the retry is what turns a
 * database outage into a delay instead of a loss.
 */
const DRAIN_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 30_000 },
};

/** Options of the receiver. */
export interface WorkerSyslogOptions {
  /** Environment the tenant id is read from. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Connection options of the queue. Defaults to `redisConnectionOptions(env)`. */
  connection?: RedisConnectionOptions;
}

/** A running receiver. */
export interface WorkerSyslogHandle {
  /** Stops the receiver and closes the queue. */
  stop(): Promise<void>;
}

/**
 * Starts the syslog receiver of the worker.
 *
 * The gate is the one of the package: `SYSLOG_RECEIVER_ENABLED=true` and
 * `SYSLOG_TENANT_ID` set. The package decides whether it binds; the worker
 * only reacts to the events it spools.
 */
export function startWorkerSyslogReceiver(options: WorkerSyslogOptions = {}): WorkerSyslogHandle {
  const env = options.env ?? process.env;
  const tenantId = env['SYSLOG_TENANT_ID']?.trim();
  const connection = options.connection ?? redisConnectionOptions(env);

  // The queue is opened with the first event: a worker that never receives a
  // datagram keeps no Redis connection open.
  let queue: JobQueue<'ingest'> | null = null;

  function queueOf(): JobQueue<'ingest'> {
    if (queue === null) {
      queue = createJobQueue('ingest', connection);
      // A queue whose Redis is down emits the connection error. Without a
      // listener it would surface as an unhandled error event, and the
      // receiver has to survive a queue outage.
      queue.on('error', (error: Error) => {
        console.error(`[worker] ingest queue error: ${error.message}`);
        // The enqueue is still waiting for the connection, so this is the
        // first sign of the outage an operator has to see.
        recordSchedulerError('syslog', `ingest drain enqueue failed: ${error.message}`);
      });
    }
    return queue;
  }

  /**
   * Asks the worker to drain the spool.
   *
   * The event is already on disk when this runs: a queue outage only delays
   * the write, it never loses the event.
   */
  async function enqueueDrain(ingestId: string): Promise<void> {
    try {
      await enqueueJob(
        queueOf(),
        JOB_NAMES.ingestDrain,
        { source: 'syslog', tenantId, ingestId },
        {
          // The stable job id is what makes the drain at-least-once instead
          // of at-least-twice: the same event is never ingested twice, even
          // if the job is retried.
          jobId: ingestDrainJobId('syslog', ingestId),
          ...DRAIN_JOB_OPTIONS,
        },
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error(
        `[worker] could not enqueue the ingest drain job for ${ingestId}: ${detail}`,
      );
      // The operator has to see it: a socket that received events nobody
      // drains is a silent loss of telemetry.
      recordSchedulerError('syslog', `ingest drain enqueue failed: ${detail}`);
    }
  }

  const stop = startSyslogReceiver({
    // The worker drains through the queue, never in process.
    startInProcessDrainer: false,
    onEventSpooled: (ingestId) => {
      // `null` means the spool refused the event: it is not on disk, so
      // there is nothing to drain.
      if (ingestId === null || !tenantId) return;
      void enqueueDrain(ingestId);
    },
  });

  return {
    async stop(): Promise<void> {
      stop();
      await queue?.close();
      queue = null;
    },
  };
}
