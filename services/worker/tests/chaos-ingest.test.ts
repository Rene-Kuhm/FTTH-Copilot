import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { JobHandler } from '@ftth-copilot/jobs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type EventRow = {
  ingestId: string;
  tenantId: string;
  message: string;
};

const { createMany } = vi.hoisted(() => ({
  createMany: vi.fn<(args: { data: EventRow[]; skipDuplicates: boolean }) => Promise<{ count: number }>>(),
}));

vi.mock('@ftth-copilot/db', () => ({
  prisma: { deviceEvent: { createMany } },
}));

const payload = { source: 'syslog', tenantId: 'tenant-chaos-a' } as const;
const job = { id: 'chaos-drain' } as Parameters<JobHandler<'ingest-drain'>>[1];

async function startDrainWorker() {
  const ingest = await import('@ftth-copilot/ingest');
  const { JOB_HANDLERS } = await import('../src/registry');
  const handler = JOB_HANDLERS['ingest-drain'];
  if (!handler) throw new Error('Missing ingest-drain handler');
  return { ...ingest, drain: () => handler(payload, job) };
}

function enqueue(worker: Awaited<ReturnType<typeof startDrainWorker>>, tenantId: string, message: string) {
  const ingestId = worker.spoolEvent({ tenantId, category: 'other', severity: 4, message });
  expect(ingestId).toBeTruthy();
  return { tenantId, ingestId, message };
}

describe('ingest chaos at the worker boundary', () => {
  let dir: string;
  let worker: Awaited<ReturnType<typeof startDrainWorker>>;
  let rows: EventRow[];

  function recoverStore() {
    createMany.mockImplementation(async ({ data, skipDuplicates }) => {
      const inserted = data.filter((event) =>
        !skipDuplicates || !rows.some((row) => row.ingestId === event.ingestId),
      );
      rows.push(...inserted);
      return { count: inserted.length };
    });
  }

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'ftth-chaos-spool-'));
    vi.stubEnv('EVENT_SPOOL_DIR', dir);
    createMany.mockReset();
    rows = [];
    worker = await startDrainWorker();
  });

  afterEach(() => {
    worker?.__closeSpoolForTests();
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  it('keeps events for both tenants through repeated DB failures and drains on retry', async () => {
    createMany.mockRejectedValue(Object.assign(new Error('Postgres unreachable'), { code: 'P1001' }));
    const first = enqueue(worker, 'tenant-chaos-a', 'queued before the first attempt');
    await expect(worker.drain()).rejects.toThrow('1 events; they stay in the spool');

    const second = enqueue(worker, 'tenant-chaos-b', 'queued during the outage');
    await expect(worker.drain()).rejects.toThrow('2 events; they stay in the spool');
    expect(createMany).toHaveBeenCalledTimes(2);
    expect(worker.eventIngestStats()).toMatchObject({ backlog: 2, quarantinedTotal: 0, dropped: 0 });
    expect(rows).toEqual([]);

    recoverStore();
    await expect(worker.drain()).resolves.toMatchObject({
      drained: 2, failed: 0, quarantined: 0, backlogRemains: false,
    });
    expect(rows).toMatchObject([first, second]);
    await expect(worker.drain()).resolves.toMatchObject({ drained: 0, backlogRemains: false });
    expect(createMany).toHaveBeenCalledTimes(3);
  });

  it('replays the unacknowledged batch after restarting the drain worker without duplicating rows', async () => {
    const first = enqueue(worker, 'tenant-chaos-a', 'committed before the connection dropped');
    recoverStore();
    const insert = createMany.getMockImplementation();
    if (!insert) throw new Error('Missing store implementation');
    createMany.mockImplementationOnce(async (args) => {
      await insert(args);
      throw Object.assign(new Error('Connection lost after commit'), { code: 'P1017' });
    });

    await expect(worker.drain()).rejects.toThrow('stay in the spool');
    expect(rows).toMatchObject([first]);
    expect(worker.eventIngestStats()).toMatchObject({ backlog: 1, quarantinedTotal: 0 });
    const second = enqueue(worker, 'tenant-chaos-b', 'still pending at restart');

    worker.__closeSpoolForTests();
    vi.resetModules();
    worker = await startDrainWorker();
    await expect(worker.drain()).resolves.toMatchObject({
      drained: 2, failed: 0, quarantined: 0, backlogRemains: false,
    });
    expect(createMany).toHaveBeenCalledTimes(2);
    expect(createMany.mock.lastCall?.[0]).toMatchObject({ data: [first, second], skipDuplicates: true });
    expect(rows).toMatchObject([first, second]);
  });
});
