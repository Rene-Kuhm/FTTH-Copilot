import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JOB_NAMES, QUEUE_NAMES } from '../../src/definitions';
import { redisConnectionOptions, workerRedisConnectionOptions } from '../../src/connection';
import { createJobQueue, enqueueJob, scheduleRecurring, type JobQueue } from '../../src/queue';
import { defineWorker, type JobWorker } from '../../src/worker';

/**
 * Integration specs for the job queue.
 *
 * They need a live Redis: point `JOBS_TEST_REDIS_URL` at one. The suite
 * skips itself when the variable is missing, so the hermetic unit run stays
 * green on a machine without Redis.
 */
const REDIS_URL = process.env['JOBS_TEST_REDIS_URL'];
const suite = REDIS_URL ? describe : describe.skip;

const QUEUE_CONNECTION = redisConnectionOptions({ REDIS_URL: REDIS_URL ?? '' });
const WORKER_CONNECTION = workerRedisConnectionOptions({ REDIS_URL: REDIS_URL ?? '' });

let queue: JobQueue<'ingest'>;
let worker: JobWorker<'ingest'> | undefined;

/**
 * Polls until `read` returns a value. BullMQ reports state changes
 * asynchronously and offers no promise for "the job failed", so the specs
 * wait for the observable state instead of for an event.
 */
async function waitFor<T>(
  read: () => T | undefined | Promise<T | undefined>,
  timeoutMs = 15_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error('Timed out waiting for the queue to settle');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

suite('job queue (integration)', () => {
  beforeEach(async () => {
    queue = createJobQueue('ingest', QUEUE_CONNECTION);
    await queue.drain(true);
    await queue.clean(0, 1000, 'completed');
    await queue.clean(0, 1000, 'failed');
  });

  afterEach(async () => {
    await worker?.close();
    worker = undefined;
  });

  afterAll(async () => {
    await queue?.close();
  });

  it('enqueues a job and the worker consumes it', async () => {
    const received: unknown[] = [];
    worker = defineWorker(
      'ingest',
      {
        [JOB_NAMES.ingestDrain]: async (data) => {
          received.push(data);
          return 'drained';
        },
      },
      { connection: WORKER_CONNECTION },
    );

    await enqueueJob(queue, JOB_NAMES.ingestDrain, { source: 'syslog', ingestId: 'ing_1' });

    await waitFor(() => (received.length > 0 ? received : undefined));
    expect(received).toEqual([{ source: 'syslog', ingestId: 'ing_1' }]);
  });

  it('never enqueues the same job id twice', async () => {
    await enqueueJob(
      queue,
      JOB_NAMES.ingestDrain,
      { source: 'syslog', ingestId: 'ing_1' },
      { jobId: 'ingest-drain-syslog-ing_1' },
    );
    await enqueueJob(
      queue,
      JOB_NAMES.ingestDrain,
      { source: 'syslog', ingestId: 'ing_1' },
      { jobId: 'ingest-drain-syslog-ing_1' },
    );

    const counts = await queue.getJobCounts('waiting', 'delayed');
    expect(counts.waiting + counts.delayed).toBe(1);
  });

  it('retries a failing job', async () => {
    let attempts = 0;
    worker = defineWorker(
      'ingest',
      {
        [JOB_NAMES.ingestDrain]: async () => {
          attempts += 1;
          throw new Error('still failing');
        },
      },
      { connection: WORKER_CONNECTION },
    );

    await enqueueJob(
      queue,
      JOB_NAMES.ingestDrain,
      { source: 'snmp', ingestId: 'ing_2' },
      { attempts: 3, backoff: { type: 'fixed', delay: 50 } },
    );

    await waitFor(() => (attempts >= 3 ? attempts : undefined));
    expect(attempts).toBe(3);
  });

  it('dead-letters a job that exhausts its retries', async () => {
    worker = defineWorker(
      'ingest',
      {
        [JOB_NAMES.ingestDrain]: async () => {
          throw new Error('permanently broken');
        },
      },
      { connection: WORKER_CONNECTION },
    );

    await enqueueJob(
      queue,
      JOB_NAMES.ingestDrain,
      { source: 'snmp', ingestId: 'ing_3' },
      { attempts: 2, backoff: { type: 'fixed', delay: 50 }, removeOnFail: false },
    );

    const counts = await waitFor(async () => {
      const current = await queue.getJobCounts('failed');
      return current.failed > 0 ? current : undefined;
    });
    expect(counts.failed).toBe(1);

    const failed = await queue.getJobs(['failed'], 0, 10);
    expect(failed).toHaveLength(1);
    expect(failed[0]?.failedReason).toContain('permanently broken');
  });

  it('schedules a recurring job idempotently', async () => {
    const schedule = {
      schedulerId: 'scheduler-ingest-drain',
      everyMs: 60_000,
      name: JOB_NAMES.ingestDrain,
      data: { source: 'syslog' as const },
    };

    await scheduleRecurring(queue, schedule);
    await scheduleRecurring(queue, schedule);

    const schedulers = await queue.getJobSchedulers();
    expect(schedulers).toHaveLength(1);
    expect(schedulers[0]?.key).toBe('scheduler-ingest-drain');

    await queue.removeJobScheduler('scheduler-ingest-drain');
  });

  it('fails a job whose handler is not registered', async () => {
    worker = defineWorker('ingest', {}, { connection: WORKER_CONNECTION });

    await enqueueJob(
      queue,
      JOB_NAMES.ingestDrain,
      { source: 'syslog', ingestId: 'ing_4' },
      { attempts: 1, removeOnFail: false },
    );

    const counts = await waitFor(async () => {
      const current = await queue.getJobCounts('failed');
      return current.failed > 0 ? current : undefined;
    });
    expect(counts.failed).toBe(1);

    const failed = await queue.getJobs(['failed'], 0, 10);
    expect(failed[0]?.failedReason).toContain('No handler registered');
  });
});
