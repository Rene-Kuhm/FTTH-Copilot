import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import dgram from 'node:dgram';
import { prisma } from '@ftth-copilot/db';
import { snapshotHealth } from '@ftth-copilot/scheduler';
import {
  JOB_NAMES,
  createJobQueue,
  defineWorker,
  enqueueJob,
  ingestDrainJobId,
  redisConnectionOptions,
  workerRedisConnectionOptions,
  type JobQueue,
} from '@ftth-copilot/jobs';
import { JOB_HANDLERS } from '../src/registry';

/**
 * The drain job handler against a real Postgres.
 *
 * The suite needs a live database: point `DATABASE_URL` at one. It skips
 * itself when the variable is missing, so the hermetic unit run stays green
 * on a machine without Postgres (same convention as `packages/db`).
 *
 * The Redis suite at the bottom needs both: point `JOBS_TEST_REDIS_URL` at a
 * live Redis to exercise the whole path (socket → spool → queue → Postgres).
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const REDIS_URL = process.env['JOBS_TEST_REDIS_URL'];

const dbSuite = DATABASE_URL?.startsWith('postgres') ? describe : describe.skip;
const endToEndSuite =
  DATABASE_URL?.startsWith('postgres') && REDIS_URL ? describe : describe.skip;

const TENANT = 'it-ingest-drain';

/**
 * The tenant of the suite.
 *
 * A device event references a tenant, so the tenant has to exist before the
 * event can be stored.
 */
async function createTenant(): Promise<void> {
  await prisma.tenant.upsert({
    where: { slug: TENANT },
    update: {},
    create: { id: TENANT, name: 'Ingest drain integration', slug: TENANT },
  });
}

async function removeTenant(): Promise<void> {
  await prisma.deviceEvent.deleteMany({ where: { tenantId: TENANT } });
  await prisma.tenant.deleteMany({ where: { id: TENANT } });
}

/** Rows of this suite's tenant. */
async function rows(): Promise<Array<{ ingestId: string | null; message: string }>> {
  return prisma.deviceEvent.findMany({
    where: { tenantId: TENANT },
    select: { ingestId: true, message: true },
  });
}

/** Polls until `read` returns a value. */
async function waitFor<T>(
  read: () => T | undefined | Promise<T | undefined>,
  timeoutMs = 15_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error('Timed out waiting for the drain to settle');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** A free UDP port, asked from the kernel. */
function freeUdpPort(): Promise<number> {
  const probe = dgram.createSocket('udp4');
  return new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.bind(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

/** Sends a syslog datagram to the receiver. */
function sendDatagram(port: number, message: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const client = dgram.createSocket('udp4');
    client.send(Buffer.from(message, 'utf8'), port, '127.0.0.1', (error) => {
      client.close();
      if (error) reject(error);
      else resolve();
    });
  });
}

dbSuite('ingest drain (Postgres integration)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'ingest-drain-'));
    process.env['EVENT_SPOOL_DIR'] = dir;
    // The spool is a module singleton: drop it so it is created again, in
    // this test's directory.
    const { __setSpoolForTests } = await import('@ftth-copilot/ingest');
    __setSpoolForTests(null);
    await createTenant();
    await prisma.deviceEvent.deleteMany({ where: { tenantId: TENANT } });
  });

  afterEach(async () => {
    await removeTenant();
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes the spooled events into Postgres', async () => {
    const { spoolEvent } = await import('@ftth-copilot/ingest');
    spoolEvent({ tenantId: TENANT, category: 'other', message: 'integration event', severity: 4 });

    await JOB_HANDLERS[JOB_NAMES.ingestDrain]?.({ source: 'syslog' }, {} as never);

    const stored = await rows();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.message).toBe('integration event');
    expect(stored[0]?.ingestId).toMatch(/^[0-9a-f]{8}-[0-9a-z]+$/);
  });

  it('is a no-op on an empty spool', async () => {
    await JOB_HANDLERS[JOB_NAMES.ingestDrain]?.({ source: 'syslog' }, {} as never);

    expect(await rows()).toHaveLength(0);
  });

  it('stores the same event only once when the batch is replayed', async () => {
    const { DurableSpool } = await import('@ftth-copilot/ingest');
    const { ingestEvents } = await import('@ftth-copilot/soc');

    // A batch replayed after a crash between the write and the commit of the
    // offset: the same ingest id reaches the store twice.
    const ingestId = 'ing-replay-1';
    writeFileSync(
      join(dir, 'events.jsonl'),
      `${JSON.stringify({
        ingestId,
        payload: { tenantId: TENANT, category: 'other', message: 'replayed', severity: 4 },
      })}\n`,
    );

    const first = new DurableSpool<{ tenantId: string; category: 'other'; message: string }>({ dir });
    const batch = first.readBatch(10);
    await ingestEvents(
      batch.entries.map((entry) => ({ ...entry.payload, ingestId: entry.ingestId })),
    );
    first.close();

    const second = new DurableSpool<{ tenantId: string; category: 'other'; message: string }>({ dir });
    const replay = second.readBatch(10);
    expect(replay.entries).toHaveLength(1);
    await ingestEvents(
      replay.entries.map((entry) => ({ ...entry.payload, ingestId: entry.ingestId })),
    );
    second.commit(replay.nextOffset, replay.entries.length);
    second.close();

    expect(await rows()).toHaveLength(1);
  });
});

endToEndSuite('ingest drain (queue + Postgres integration)', () => {
  let dir: string;
  let queue: JobQueue<'ingest'>;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'ingest-drain-e2e-'));
    process.env['EVENT_SPOOL_DIR'] = dir;
    // The spool is a module singleton: drop it so it is created again, in
    // this test's directory.
    const { __setSpoolForTests } = await import('@ftth-copilot/ingest');
    __setSpoolForTests(null);
    await createTenant();
    await prisma.deviceEvent.deleteMany({ where: { tenantId: TENANT } });

    // Each test starts with an empty queue. The jobs of the previous test
    // are removed because the ingest id — and with it the job id — is
    // derived from the spool, which restarts its counter with every new
    // instance.
    queue = createJobQueue('ingest', redisConnectionOptions({ REDIS_URL: REDIS_URL ?? '' }));
    await queue.drain(true);
    await queue.clean(0, 1000, 'completed');
    await queue.clean(0, 1000, 'failed');
  });

  afterEach(async () => {
    await removeTenant();
    await queue.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('stores the event once when the same drain job is enqueued twice', async () => {
    const { spoolEvent } = await import('@ftth-copilot/ingest');
    const workerConnection = workerRedisConnectionOptions({ REDIS_URL: REDIS_URL ?? '' });

    const worker = defineWorker('ingest', JOB_HANDLERS, { connection: workerConnection });

    try {
      const ingestId = spoolEvent({
        tenantId: TENANT,
        category: 'other',
        message: 'enqueued twice',
        severity: 4,
      });
      expect(ingestId).not.toBeNull();

      const payload = { source: 'syslog' as const, tenantId: TENANT, ingestId: ingestId ?? '' };
      const jobId = ingestDrainJobId('syslog', ingestId ?? '');

      await enqueueJob(queue, JOB_NAMES.ingestDrain, payload, { jobId });
      // The same event, enqueued again: the stable job id collapses it into
      // one job, and the store keeps one row.
      await enqueueJob(queue, JOB_NAMES.ingestDrain, payload, { jobId });

      const stored = await waitFor(async () => {
        const found = await rows();
        return found.length > 0 ? found : undefined;
      });

      expect(stored).toHaveLength(1);
      expect(stored[0]?.ingestId).toBe(ingestId);
    } finally {
      await worker.close();
    }
  });

  it('stores a datagram that arrives at the worker', async () => {
    const { startWorkerSyslogReceiver } = await import('../src/syslog');
    const connection = redisConnectionOptions({ REDIS_URL: REDIS_URL ?? '' });
    const workerConnection = workerRedisConnectionOptions({ REDIS_URL: REDIS_URL ?? '' });

    const port = await freeUdpPort();
    process.env['REDIS_URL'] = REDIS_URL ?? '';
    process.env['SYSLOG_RECEIVER_ENABLED'] = 'true';
    process.env['SYSLOG_TENANT_ID'] = TENANT;
    process.env['SYSLOG_UDP_PORT'] = String(port);

    const worker = defineWorker('ingest', JOB_HANDLERS, { connection: workerConnection });
    const receiver = startWorkerSyslogReceiver({ env: process.env });

    try {
      // The socket binds asynchronously: wait for it before sending.
      await waitFor(() =>
        snapshotHealth()['syslog']?.bound === true ? true : undefined,
      );

      // The whole path: socket -> spool -> queue -> Postgres.
      await sendDatagram(
        port,
        '<134>1 2026-10-31 16:00:00 gw01 link state down on ge-0/0/1',
      );

      const stored = await waitFor(async () => {
        const found = await rows();
        return found.length > 0 ? found : undefined;
      });

      expect(stored).toHaveLength(1);
      expect(stored[0]?.message).toContain('link state down');
      expect(stored[0]?.ingestId).toMatch(/^[0-9a-f]{8}-[0-9a-z]+$/);
    } finally {
      await receiver.stop();
      await worker.close();
    }
  });
});
