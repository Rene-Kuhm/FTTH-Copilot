/**
 * Producer side of the recurring loops.
 *
 * The worker owns the schedule of the background work: it registers one
 * recurring schedule per loop and enqueues the first tick immediately. The
 * web no longer decides *when* the polling, the firmware audit and the FEC
 * collection happen — it only serves what the worker produced.
 *
 * Idempotency (S7 — "cada loop recurrente es idempotente por ventana"):
 *
 * The original plan asked for a stable `jobId` per window
 * (`poll:<connId>:<minuto>`), so two workers could not run the same tick
 * twice. BullMQ v6 removed the `repeat` option and the `Repeat` class, so
 * that primitive does not exist for recurring jobs anymore: a scheduled job
 * cannot even carry a job id of its own.
 *
 * The guarantee now comes from two things:
 *
 *   1. `upsertJobScheduler` is idempotent per scheduler id. The id here is
 *      `recurringSchedulerId(scope)` — stable across processes and restarts —
 *      so N worker replicas calling this function N times still leave exactly
 *      one schedule per loop.
 *   2. BullMQ's job delivery is atomic: a job produced by a Job Scheduler is
 *      handed to exactly one worker, so a tick is never executed twice by the
 *      fleet.
 *
 * Both were measured against BullMQ 6.5.3, not assumed: three upserts of the
 * same scheduler id leave one job, and a second replica re-registering the
 * schedule does not reset the iteration grid, so it does not produce an
 * extra tick either.
 *
 * The first tick is produced by the schedule itself, not by a separate
 * one-shot job. BullMQ's `every` scheduler produces its first job
 * immediately, so a one-shot tick on top of it would poll the NMS twice at
 * every boot. The schedule is started at `now + WARMUP_MS` instead, which
 * reproduces the five-second warm-up the in-process loop had.
 *
 * The warm-up after a restart (S9):
 *
 * That works on a cold start only. `upsertJobScheduler` does not reprogram a
 * schedule that already exists — BullMQ keeps the iteration grid of the
 * schedule that is there — so after a restart the first tick of a loop is
 * the one the grid had planned, which for the firmware is 24 h away. The
 * worker compares that next run with the clock and, when it is too far
 * away, forces a warm-up tick of its own. Its job id comes from the slot of
 * the grid, so two workers booting at the same time force the same job and
 * BullMQ enqueues one.
 */

import { createLogger } from '@ftth-copilot/shared';
import { markExpected, setNextRun, type SchedulerName } from '@ftth-copilot/scheduler';
import {
  JOB_NAMES,
  createJobQueue,
  enqueueJob,
  nextSchedulerRun,
  recurringSchedulerId,
  redisConnectionOptions,
  scheduleRecurring,
  type JobName,
  type JobQueue,
  type QueueData,
  type QueueJobMap,
  type QueueKey,
  type RedisConnectionOptions,
} from '@ftth-copilot/jobs';
import { decideWarmup, warmupJobId, WARMUP_MS } from './warmup';

const log = createLogger({ name: 'worker-schedules' });

/**
 * Grace period before the first tick of a loop, in milliseconds.
 *
 * Re-exported from the module of the warm-up, where the decision about it
 * lives.
 */
export { WARMUP_MS } from './warmup';

/**
 * How many completed warm-up jobs are kept.
 *
 * The id of a warm-up job is what reserves its slot: while the job is there,
 * a second worker that boots in the same slot cannot enqueue another one.
 * The retention keeps the id taken after the job ran.
 */
const WARMUP_JOB_RETENTION = 20;

/**
 * How often the deadline of every loop is refreshed, in milliseconds.
 *
 * The deadline moves with the grid of the schedule, and the grid moves
 * without this process doing anything: a loop that another replica consumes
 * advances the grid from the outside. Reading it from time to time is what
 * keeps the deadline of the loops honest.
 */
export const LOOP_DEADLINE_REFRESH_MS = 30_000;

/** Retry policy of every tick the worker produces. */
const TICK_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 30_000 },
};

/** Description of one recurring loop. */
export interface LoopDefinition<Q extends QueueKey> {
  /**
   * Stable scope of the loop.
   *
   * The scheduler id and the window job id of the first tick derive from it,
   * so it must not change between releases.
   */
  scope: string;
  /** Logical queue the jobs of the loop live in. */
  queue: Q;
  /** Job name the queue accepts for this loop. */
  jobName: QueueJobMap[Q];
  /** Payload carried by every tick. */
  data: QueueData<Q>;
  /**
   * Env flag that enables the loop.
   *
   * Optional: a loop without a flag is always registered. The periodic drain
   * of the spool is such a loop — it is the safety net of the ingestion, and
   * a safety net that only exists when a flag says so is not one.
   */
  enabledFlag?: string;
  /** Env var with the period of the loop, in milliseconds. */
  intervalFlag: string;
  /** Period used when the env var is unset or invalid, in milliseconds. */
  defaultIntervalMs: number;
  /**
   * The name of this loop in the health registry.
   *
   * Optional: the loops that are not in the registry —the safety nets— do
   * not have one. The registry watches the loops that produce telemetry,
   * and a loop it does not know about cannot be reported as hung.
   */
  healthName?: SchedulerName;
}

/** The polling loop: samples every connected NMS. */
export const POLL_LOOP: LoopDefinition<'poll'> = {
  scope: 'poll-connections',
  queue: 'poll',
  jobName: JOB_NAMES.pollConnections,
  data: {},
  enabledFlag: 'METRICS_POLLER_ENABLED',
  intervalFlag: 'METRICS_POLL_INTERVAL_MS',
  defaultIntervalMs: 900_000,
  healthName: 'polling',
};

/** The firmware audit loop: checks live firmware against the allowlist. */
export const FIRMWARE_LOOP: LoopDefinition<'firmware'> = {
  scope: 'firmware-audit',
  queue: 'firmware',
  jobName: JOB_NAMES.firmwareAudit,
  data: {},
  enabledFlag: 'FIRMWARE_AUDIT_ENABLED',
  intervalFlag: 'FIRMWARE_AUDIT_INTERVAL_MS',
  defaultIntervalMs: 86_400_000,
  healthName: 'firmware',
};

/** The FEC collection loop: samples optical telemetry of a slice of ONUs. */
export const FEC_LOOP: LoopDefinition<'fec'> = {
  scope: 'fec-collection',
  queue: 'fec',
  jobName: JOB_NAMES.fecCollection,
  data: {},
  enabledFlag: 'FEC_COLLECTION_ENABLED',
  intervalFlag: 'FEC_COLLECTION_INTERVAL_MS',
  defaultIntervalMs: 3_600_000,
  healthName: 'fec',
};

/**
 * The periodic drain of the durable spool.
 *
 * Every received trap enqueues its own drain job, but that enqueue can fail
 * with Redis down: the trap is already safe on disk, and nothing would ask
 * for it to be drained until another trap arrived. This schedule is the net
 * that catches it.
 *
 * The payload names the `syslog` source, but the handler drains the whole
 * spool whatever the source says, so one schedule covers both receivers.
 */
export const INGEST_DRAIN_LOOP: LoopDefinition<'ingest'> = {
  scope: 'ingest-drain',
  queue: 'ingest',
  jobName: JOB_NAMES.ingestDrain,
  data: { source: 'syslog' },
  intervalFlag: 'INGEST_DRAIN_INTERVAL_MS',
  defaultIntervalMs: 30_000,
};

/**
 * The sweep of abandoned investigation attempts.
 *
 * An attempt can stay `pending` forever if the process that ran it died, or if
 * it was stuck before the fix of task T12. `expired` does not block the
 * "investigate" button, so the sweep is what gives the operator the incident
 * back. No enable flag, for the same reason as the drain: it is a safety net.
 * The TTL itself is read by the handler from `INVESTIGATION_PENDING_TTL_MS`.
 */
export const INVESTIGATION_SWEEP_LOOP: LoopDefinition<'investigationSweep'> = {
  scope: 'investigation-sweep',
  queue: 'investigationSweep',
  jobName: JOB_NAMES.investigationSweep,
  data: {},
  intervalFlag: 'INVESTIGATION_SWEEP_INTERVAL_MS',
  defaultIntervalMs: 60_000,
};

/**
 * The learning snapshot loop: freezes the dataset of every tenant.
 *
 * It has an enable flag, unlike the safety nets: the snapshot writes rows and
 * costs a query per tenant, and until the learning loop has a consumer (the
 * evaluation job of Fase 5) there is no reason to freeze a dataset every day.
 * The default therefore leaves the behaviour of the deployment unchanged.
 */
export const LEARNING_SNAPSHOT_LOOP: LoopDefinition<'learning'> = {
  scope: 'learning-snapshot',
  queue: 'learning',
  jobName: JOB_NAMES.learningSnapshot,
  data: {},
  enabledFlag: 'LEARNING_SNAPSHOT_ENABLED',
  intervalFlag: 'LEARNING_SNAPSHOT_INTERVAL_MS',
  defaultIntervalMs: 86_400_000,
};

/** A loop that was registered. */
export interface RegisteredLoop {
  /** Stable scope of the loop. */
  scope: string;
  /** Logical queue the loop's jobs live in. */
  queue: QueueKey;
  /** Job name the loop produces. */
  jobName: JobName;
  /** Id of the recurring schedule. */
  schedulerId: string;
  /** Period of the loop, in milliseconds. */
  everyMs: number;
  /** When the first tick is due, in epoch milliseconds. */
  firstTickAtMs: number;
  /**
   * When the next tick of the schedule is really due, in epoch milliseconds.
   *
   * It is not `firstTickAtMs` after a restart: the grid of a schedule that
   * already exists is not reprogrammed, so the tick that is due is the one
   * the grid had planned. Null when the schedule has no next run.
   */
  nextRunAtMs: number | null;
}

/** A loop that was not registered, and why. */
export interface SkippedLoop {
  /** Stable scope of the loop. */
  scope: string;
  /** Why the loop was not registered. */
  reason: string;
}

/** Outcome of the registration. */
export interface RegisterSchedulesResult {
  /** The loops that got a recurring schedule. */
  registered: RegisteredLoop[];
  /** The loops that were left out. */
  skipped: SkippedLoop[];
}

/** Options of `registerRecurringSchedules`. */
export interface RegisterSchedulesOptions {
  /** Environment the flags and the intervals are read from. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Connection options. Defaults to `redisConnectionOptions(env)`. */
  connection?: RedisConnectionOptions;
}

/**
 * Reads a period from the environment.
 *
 * Same contract as the in-process loops: a missing or invalid value falls
 * back to the default of the loop.
 */
function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * A loop this process registered, with what is needed to read its schedule.
 *
 * The state lives in the module: the worker reads the grid of its own loops
 * from time to time to publish when their next tick is due.
 */
interface RegisteredLoopState {
  scope: string;
  queue: QueueKey;
  schedulerId: string;
  everyMs: number;
  healthName?: SchedulerName;
}

/** The loops this process registered. */
const REGISTERED_LOOPS = new Map<string, RegisteredLoopState>();

/**
 * The queues this process opened to read its own schedules.
 *
 * They stay open for the life of the process: the deadline of the loops is
 * read from them, and the worker already holds a connection per queue for
 * the consumers.
 */
const SCHEDULE_QUEUES = new Map<QueueKey, JobQueue<QueueKey>>();

/**
 * Registers one loop: the recurring schedule and, when the schedule needs
 * it, the warm-up tick.
 *
 * The queue stays open: the deadline of the loop is read from it.
 */
async function registerLoop<Q extends QueueKey>(
  definition: LoopDefinition<Q>,
  env: NodeJS.ProcessEnv,
  connection: RedisConnectionOptions,
): Promise<RegisteredLoop | SkippedLoop> {
  if (definition.enabledFlag !== undefined && env[definition.enabledFlag] !== 'true') {
    return {
      scope: definition.scope,
      reason: `${definition.enabledFlag} is not "true"`,
    };
  }

  const everyMs = positiveInt(env[definition.intervalFlag], definition.defaultIntervalMs);
  const schedulerId = recurringSchedulerId(definition.scope);
  const queue = createJobQueue(definition.queue, connection);

  // A queue without an error listener prints raw stack traces when Redis is
  // unreachable. The schedule registration below is best-effort on purpose
  // (a Redis outage must not take the worker down), so the failure has to be
  // reported in one readable line instead.
  queue.on('error', (error: Error) => {
    log.warn('Queue error', { scope: definition.scope, error });
  });

  try {
    // The schedule produces its first job at `startDateMs` and then follows
    // the period from there, so the loop ticks five seconds after the worker
    // comes up and every interval after that.
    const firstTickAtMs = Date.now() + WARMUP_MS;
    await scheduleRecurring(queue, {
      schedulerId,
      everyMs,
      startDateMs: firstTickAtMs,
      name: definition.jobName,
      data: definition.data,
      options: TICK_OPTIONS,
    });

    // The upsert above does not reprogram a schedule that already exists:
    // the grid that keeps ticking is the one of the first boot. Reading it
    // is the only way to know when the next tick of this loop is really due.
    const nextRunAtMs = await nextSchedulerRun(queue, schedulerId);

    const warmup = decideWarmup({ nextRunAtMs, nowMs: Date.now() });
    if (warmup.force && nextRunAtMs !== null) {
      // The id comes from the slot of the grid: two workers that boot while
      // the schedule is in the same slot force the same job, and BullMQ
      // enqueues one.
      const jobId = warmupJobId(definition.scope, nextRunAtMs);
      await enqueueJob(queue, definition.jobName, definition.data, {
        jobId,
        delayMs: WARMUP_MS,
        attempts: TICK_OPTIONS.attempts,
        backoff: TICK_OPTIONS.backoff,
        removeOnComplete: WARMUP_JOB_RETENTION,
      });
      log.info('Warm-up tick enqueued', {
        scope: definition.scope,
        jobId,
        nextRunAt: new Date(nextRunAtMs).toISOString(),
      });
    }

    SCHEDULE_QUEUES.set(definition.queue, queue as JobQueue<QueueKey>);
    REGISTERED_LOOPS.set(definition.scope, {
      scope: definition.scope,
      queue: definition.queue,
      schedulerId,
      everyMs,
      healthName: definition.healthName,
    });

    return {
      scope: definition.scope,
      queue: definition.queue,
      jobName: definition.jobName,
      schedulerId,
      everyMs,
      firstTickAtMs,
      nextRunAtMs,
    };
  } catch (error) {
    await queue.close();
    throw error;
  }
}

/**
 * Registers every loop whose env flag is enabled.
 *
 * Calling it twice is safe: the recurring schedule is an upsert keyed by a
 * stable scheduler id, and BullMQ keeps the iteration grid of an existing
 * schedule, so the boot of a second worker replica is a no-op.
 */
export async function registerRecurringSchedules(
  options: RegisterSchedulesOptions = {},
): Promise<RegisterSchedulesResult> {
  const env = options.env ?? process.env;
  // A producer fails fast when Redis is down: the workers need
  // `maxRetriesPerRequest: null`, the producer does not.
  const connection = options.connection ?? redisConnectionOptions(env);

  const registered: RegisteredLoop[] = [];
  const skipped: SkippedLoop[] = [];

  for (const definition of [
    POLL_LOOP,
    FIRMWARE_LOOP,
    FEC_LOOP,
    INGEST_DRAIN_LOOP,
    INVESTIGATION_SWEEP_LOOP,
    LEARNING_SNAPSHOT_LOOP,
  ] as LoopDefinition<QueueKey>[]) {
    const outcome = await registerLoop(definition, env, connection);
    if ('schedulerId' in outcome) {
      registered.push(outcome);
      // A scheduled loop is a loop this process is expected to run: the
      // health registry has to say so, or the health does not watch it and a
      // poll that stops ticking goes unnoticed. The deadline and the
      // cadence are what the owner of the schedule knows and the registry
      // does not: with them, a loop that has not ticked yet is warming up
      // and not dead.
      if (definition.healthName) {
        markExpected(definition.healthName, {
          intervalMs: outcome.everyMs,
          nextRunAt: outcome.nextRunAtMs,
        });
      }
    } else {
      skipped.push(outcome);
    }
  }

  return { registered, skipped };
}

/**
 * Reads the next tick of every registered loop and publishes it.
 *
 * The grid of a schedule moves on its own: the loop that consumes the tick
 * is the one that advances it, and it may be another replica. The deadline
 * that the health registry holds is therefore read from BullMQ from time to
 * time, instead of being computed from the ticks of this process.
 */
export async function refreshLoopDeadlines(): Promise<void> {
  for (const loop of REGISTERED_LOOPS.values()) {
    if (!loop.healthName) continue;
    const queue = SCHEDULE_QUEUES.get(loop.queue);
    if (!queue) continue;
    try {
      const nextRunAtMs = await nextSchedulerRun(queue, loop.schedulerId);
      setNextRun(loop.healthName, nextRunAtMs);
    } catch (error) {
      // Redis being unreachable is reported by the health of the queues; the
      // deadline that is already published stays as it is.
      log.warn('Could not read the next tick of a loop', { scope: loop.scope, error });
    }
  }
}

/**
 * Closes the queues this process opened to read its own schedules.
 */
export async function closeSchedules(): Promise<void> {
  const queues = [...SCHEDULE_QUEUES.values()];
  SCHEDULE_QUEUES.clear();
  REGISTERED_LOOPS.clear();
  await Promise.all(queues.map(async (queue) => {
    await queue.close();
  }));
}
