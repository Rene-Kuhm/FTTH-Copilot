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
 */

import {
  JOB_NAMES,
  createJobQueue,
  recurringSchedulerId,
  redisConnectionOptions,
  scheduleRecurring,
  type JobName,
  type QueueData,
  type QueueJobMap,
  type QueueKey,
  type RedisConnectionOptions,
} from '@ftth-copilot/jobs';

/**
 * Grace period before the first tick of a loop, in milliseconds.
 *
 * The in-process loops ran a warm-up five seconds after boot. The schedule
 * starts at the same instant, so the first poll lands five seconds after the
 * worker comes up instead of one full interval later.
 */
export const WARMUP_MS = 5_000;

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
  /** Env flag that enables the loop. */
  enabledFlag: string;
  /** Env var with the period of the loop, in milliseconds. */
  intervalFlag: string;
  /** Period used when the env var is unset or invalid, in milliseconds. */
  defaultIntervalMs: number;
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
 * Registers one loop: the recurring schedule and its immediate first tick.
 *
 * The queue is opened for the registration and closed right after: the
 * schedule lives in Redis, not in the connection.
 */
async function registerLoop<Q extends QueueKey>(
  definition: LoopDefinition<Q>,
  env: NodeJS.ProcessEnv,
  connection: RedisConnectionOptions,
): Promise<RegisteredLoop | SkippedLoop> {
  if (env[definition.enabledFlag] !== 'true') {
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
    console.warn(`[worker] queue "${definition.scope}" error: ${error.message}`);
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

    return {
      scope: definition.scope,
      queue: definition.queue,
      jobName: definition.jobName,
      schedulerId,
      everyMs,
      firstTickAtMs,
    };
  } finally {
    await queue.close();
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

  for (const definition of [POLL_LOOP, FIRMWARE_LOOP, FEC_LOOP] as LoopDefinition<QueueKey>[]) {
    const outcome = await registerLoop(definition, env, connection);
    if ('schedulerId' in outcome) {
      registered.push(outcome);
    } else {
      skipped.push(outcome);
    }
  }

  return { registered, skipped };
}
