/**
 * The SNMP trap receiver of the worker.
 *
 * The worker owns the UDP socket now: it binds it, spools every trap into
 * the durable spool and enqueues the job that drains the spool into Postgres.
 * The web does the same in embedded mode, through the same package.
 *
 * Two properties matter here:
 *
 *   - the spool write happens first and is durable. The enqueue is a
 *     notification, not the delivery: if Redis is down the trap is already
 *     safe on disk, the failure is surfaced and the receiver keeps running.
 *     The periodic drain schedule is the safety net that asks for the
 *     stranded events later.
 *   - the job id is stable (`ingestDrainJobId`), so the same trap is never
 *     ingested twice, even if the job is retried.
 *
 * The raw evidence of the trap does not travel through the spool: it is
 * forensics, with its own store and its own lifecycle, so it goes straight
 * to `storeEvidence`.
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
import {
  spoolSnmpTrap,
  startSnmpReceiver,
  storeEvidence,
} from '@ftth-copilot/ingest';
import { recordError as recordSchedulerError } from '@ftth-copilot/scheduler';

/**
 * Retry policy of the drain job.
 *
 * A failed drain leaves the traps on disk, so the retry is what turns a
 * database outage into a delay instead of a loss.
 */
const DRAIN_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 30_000 },
};

/**
 * Tenant the raw evidence rows belong to.
 *
 * The web stores the evidence of every trap under `default-tenant`; the
 * worker keeps that behaviour and lets the deployment name the tenant it
 * serves.
 */
const DEFAULT_EVIDENCE_TENANT_ID = 'default-tenant';

/** Options of the receiver. */
export interface WorkerSnmpOptions {
  /** Environment the flags and the tenant are read from. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Connection options of the queue. Defaults to `redisConnectionOptions(env)`. */
  connection?: RedisConnectionOptions;
}

/** A running receiver. */
export interface WorkerSnmpHandle {
  /** Stops the receiver and closes the queue. */
  stop(): Promise<void>;
}

/**
 * Starts the SNMP trap receiver of the worker.
 *
 * The gate is the one of the package: `SNMP_RECEIVER_ENABLED=true`. The
 * package decides whether it binds the socket (`SNMP_UDP_PORT`, default
 * 1162) and which senders it accepts (`SNMP_SENDER_REGISTRY_JSON`); the
 * worker only reacts to the traps it spools.
 */
export function startWorkerSnmpReceiver(options: WorkerSnmpOptions = {}): WorkerSnmpHandle {
  const env = options.env ?? process.env;
  const connection = options.connection ?? redisConnectionOptions(env);
  const evidenceTenantId = env['SNMP_TENANT_ID']?.trim() || DEFAULT_EVIDENCE_TENANT_ID;

  // The queue is opened with the first trap: a worker that never receives a
  // trap keeps no Redis connection open.
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
        recordSchedulerError('snmp', `ingest drain enqueue failed: ${error.message}`);
      });
    }
    return queue;
  }

  /**
   * Asks the worker to drain the spool.
   *
   * The trap is already on disk when this runs: a queue outage only delays
   * the write, it never loses the trap.
   */
  async function enqueueDrain(tenantId: string, ingestId: string): Promise<void> {
    try {
      await enqueueJob(
        queueOf(),
        JOB_NAMES.ingestDrain,
        { source: 'snmp', tenantId, ingestId },
        {
          // The stable job id is what makes the drain at-least-once instead
          // of at-least-twice: the same trap is never ingested twice, even
          // if the job is retried.
          jobId: ingestDrainJobId('snmp', ingestId),
          ...DRAIN_JOB_OPTIONS,
        },
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error(
        `[worker] could not enqueue the ingest drain job for ${ingestId}: ${detail}`,
      );
      // The operator has to see it: a socket that received traps nobody
      // drains is a silent loss of telemetry.
      recordSchedulerError('snmp', `ingest drain enqueue failed: ${detail}`);
    }
  }

  const stop = startSnmpReceiver({
    // The worker drains through the queue, never in process.
    startInProcessDrainer: false,
    onEvent: (event) => {
      // The trap goes to the durable spool first: it is the copy that
      // survives a database outage.
      let ingestId: string | null;
      try {
        ingestId = spoolSnmpTrap(event);
      } catch (error) {
        // A failed write has to be surfaced: the datagram is already gone
        // from the network.
        const detail = error instanceof Error ? error.message : String(error);
        recordSchedulerError('snmp', `spool write failed: ${detail}`);
        return;
      }
      // `null` means the spool refused the trap: it is not on disk, so
      // there is nothing to drain.
      if (ingestId === null) return;
      void enqueueDrain(event.tenantId, ingestId);
    },
    onEvidence: (envelope) => {
      // The raw evidence has its own store and its own retention policy: it
      // is for forensics, not for the dashboard.
      void storeEvidence(evidenceTenantId, envelope).catch(() => {
        // Never let evidence persistence disturb trap reception.
      });
    },
  });

  return {
    async stop(): Promise<void> {
      await stop();
      await queue?.close();
      queue = null;
    },
  };
}
