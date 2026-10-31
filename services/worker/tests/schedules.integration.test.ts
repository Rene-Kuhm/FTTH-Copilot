import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  JOB_NAMES,
  QUEUE_NAMES,
  createJobQueue,
  redisConnectionOptions,
  type JobQueue,
  type QueueKey,
} from '@ftth-copilot/jobs';
import { registerRecurringSchedules, WARMUP_MS } from '../src/schedules';

/**
 * Registration of the recurring schedules.
 *
 * It needs a live Redis: point `JOBS_TEST_REDIS_URL` at one. The suite skips
 * itself when the variable is missing, so the hermetic unit run stays green on
 * a machine without Redis (same convention as `packages/jobs`).
 *
 * The property under test is the one that makes the loops safe with two worker
 * replicas (S7): registering twice leaves exactly one schedule per loop and
 * exactly one tick, and that tick is deferred by the warm-up instead of
 * firing twice at boot.
 */
const REDIS_URL = process.env['JOBS_TEST_REDIS_URL'];
const suite = REDIS_URL ? describe : describe.skip;

const CONNECTION = redisConnectionOptions({ REDIS_URL: REDIS_URL ?? '' });

const LOOPS: Array<{ queue: QueueKey; jobName: string; schedulerId: string }> = [
  {
    queue: 'poll',
    jobName: JOB_NAMES.pollConnections,
    schedulerId: 'scheduler-poll-connections',
  },
  {
    queue: 'firmware',
    jobName: JOB_NAMES.firmwareAudit,
    schedulerId: 'scheduler-firmware-audit',
  },
  {
    queue: 'fec',
    jobName: JOB_NAMES.fecCollection,
    schedulerId: 'scheduler-fec-collection',
  },
  {
    queue: 'ingest',
    jobName: JOB_NAMES.ingestDrain,
    schedulerId: 'scheduler-ingest-drain',
  },
  {
    queue: 'investigationSweep',
    jobName: JOB_NAMES.investigationSweep,
    schedulerId: 'scheduler-investigation-sweep',
  },
];

const ENV_ALL_ENABLED = {
  METRICS_POLLER_ENABLED: 'true',
  FIRMWARE_AUDIT_ENABLED: 'true',
  FEC_COLLECTION_ENABLED: 'true',
};

const queues = new Map<QueueKey, JobQueue<QueueKey>>();

function queueOf(key: QueueKey): JobQueue<QueueKey> {
  let queue = queues.get(key);
  if (!queue) {
    queue = createJobQueue(key, CONNECTION) as JobQueue<QueueKey>;
    queues.set(key, queue);
  }
  return queue;
}

suite('recurring schedules (integration)', () => {
  beforeEach(async () => {
    for (const loop of LOOPS) {
      const queue = queueOf(loop.queue);
      await queue.drain(true);
      await queue.clean(0, 1000, 'completed');
      await queue.clean(0, 1000, 'failed');
      const schedulers = await queue.getJobSchedulers();
      for (const scheduler of schedulers) {
        await queue.removeJobScheduler(scheduler.key);
      }
    }
  });

  afterEach(async () => {
    for (const loop of LOOPS) {
      const queue = queueOf(loop.queue);
      const schedulers = await queue.getJobSchedulers();
      for (const scheduler of schedulers) {
        await queue.removeJobScheduler(scheduler.key);
      }
      await queue.drain(true);
    }
  });

  afterAll(async () => {
    for (const queue of queues.values()) {
      await queue.close();
    }
  });

  it('registers exactly one schedule per loop, even when called twice', async () => {
    await registerRecurringSchedules({ env: ENV_ALL_ENABLED, connection: CONNECTION });
    await registerRecurringSchedules({ env: ENV_ALL_ENABLED, connection: CONNECTION });

    for (const loop of LOOPS) {
      const schedulers = await queueOf(loop.queue).getJobSchedulers();
      expect(schedulers).toHaveLength(1);
      expect(schedulers[0]?.key).toBe(loop.schedulerId);
    }
  });

  it('produces exactly one tick, even when called twice', async () => {
    await registerRecurringSchedules({ env: ENV_ALL_ENABLED, connection: CONNECTION });
    await registerRecurringSchedules({ env: ENV_ALL_ENABLED, connection: CONNECTION });

    for (const loop of LOOPS) {
      // A second registration does not reset the iteration grid of the
      // existing schedule, so the second replica does not produce a second
      // tick: one job, and it is the one the schedule itself produced.
      const jobs = await queueOf(loop.queue).getJobs(['waiting', 'delayed'], 0, 10);
      expect(jobs).toHaveLength(1);
    }
  });

  it('defers the first tick by the warm-up, so it is not a duplicate of the schedule', async () => {
    await registerRecurringSchedules({ env: ENV_ALL_ENABLED, connection: CONNECTION });

    for (const loop of LOOPS) {
      const jobs = await queueOf(loop.queue).getJobs(['waiting', 'delayed'], 0, 10);
      expect(jobs).toHaveLength(1);

      const delay = jobs[0]?.opts?.delay ?? 0;
      // The warm-up is five seconds; the tick is due slightly before that
      // because the reading happens a moment after the registration.
      expect(delay).toBeGreaterThan(WARMUP_MS - 2_000);
      expect(delay).toBeLessThanOrEqual(WARMUP_MS);
    }
  });

  it('produces the tick with the job name the queue expects', async () => {
    await registerRecurringSchedules({ env: ENV_ALL_ENABLED, connection: CONNECTION });

    const jobs = await queueOf('poll').getJobs(['waiting', 'delayed'], 0, 10);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.name).toBe(JOB_NAMES.pollConnections);
    expect(jobs[0]?.data).toEqual({});
    // The tick belongs to the schedule, so it carries BullMQ's repeat id
    // (`repeat:<scheduler id>:<iteration timestamp>`).
    expect(jobs[0]?.id).toMatch(/^repeat:scheduler-poll-connections:\d+$/);
  });

  it('leaves the recurring schedule with its own job on the queue', async () => {
    await registerRecurringSchedules({ env: ENV_ALL_ENABLED, connection: CONNECTION });

    const jobs = await queueOf('poll').getJobs(['waiting', 'delayed'], 0, 10);
    const scheduled = jobs.filter((job) => job.id.startsWith('repeat:'));
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]?.name).toBe(JOB_NAMES.pollConnections);
  });
  it('does not register a loop whose env flag is off', async () => {
    const result = await registerRecurringSchedules({
      env: { METRICS_POLLER_ENABLED: 'true' },
      connection: CONNECTION,
    });

    // The periodic drain and the investigation sweep have no flag: they are
    // safety nets and they are always registered.
    expect(result.registered.map((loop) => loop.scope)).toEqual([
      'poll-connections',
      'ingest-drain',
      'investigation-sweep',
    ]);
    expect(result.skipped.map((loop) => loop.scope)).toEqual(
      expect.arrayContaining(['firmware-audit', 'fec-collection']),
    );

    const schedulers = await queueOf('firmware').getJobSchedulers();
    expect(schedulers).toHaveLength(0);
  });

  it('registers the schedule on the physical queue of the loop', async () => {
    await registerRecurringSchedules({ env: ENV_ALL_ENABLED, connection: CONNECTION });

    // The schedulers live in Redis under the physical queue name.
    for (const loop of LOOPS) {
      expect(QUEUE_NAMES[loop.queue]).toBeDefined();
      const schedulers = await queueOf(loop.queue).getJobSchedulers();
      expect(schedulers[0]?.key).toBe(loop.schedulerId);
    }
  });

  it('registers exactly one drain schedule, even when called twice', async () => {
    await registerRecurringSchedules({ env: ENV_ALL_ENABLED, connection: CONNECTION });
    await registerRecurringSchedules({ env: ENV_ALL_ENABLED, connection: CONNECTION });

    // The upsert is idempotent per scheduler id, so a second replica does
    // not create a second drain schedule.
    const schedulers = await queueOf('ingest').getJobSchedulers();
    expect(schedulers).toHaveLength(1);
    expect(schedulers[0]?.key).toBe('scheduler-ingest-drain');
  });

  it('produces the drain tick on the same queue the drain jobs land on', async () => {
    await registerRecurringSchedules({ env: ENV_ALL_ENABLED, connection: CONNECTION });

    // The drain schedule lives on the ingest queue, which is also where the
    // receiver enqueues its one-shot drain jobs: the worker consumes both.
    const jobs = await queueOf('ingest').getJobs(['waiting', 'delayed'], 0, 10);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.name).toBe(JOB_NAMES.ingestDrain);
    expect(jobs[0]?.data).toEqual({ source: 'syslog' });
  });
});
