import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { drainSpool, spoolEvent, stopEventDrainer } from '../src/ingest';

/**
 * The drain entry point of the package.
 *
 * The worker drains the spool from a queue job, so the drain has to be
 * callable in one shot: it runs the batches until the spool is empty or a
 * bounded number of batches is reached (a job must not run forever), and it
 * is a no-op when there is nothing to drain — the enqueue is per event, so
 * the first job usually drains everything and the rest find an empty spool.
 */
describe('drainSpool', () => {
  let dir: string;

  function payload(message: string): Parameters<typeof spoolEvent>[0] {
    return { tenantId: 'tenant-drain', category: 'other', message };
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'drain-spool-'));
    process.env['EVENT_SPOOL_DIR'] = dir;
    // The spool is a module singleton: reset it so it points at this test's
    // directory.
    stopEventDrainer();
  });

  afterEach(() => {
    stopEventDrainer();
    rmSync(dir, { recursive: true, force: true });
  });

  it('drains every spooled event into the store', async () => {
    spoolEvent(payload('first'));
    spoolEvent(payload('second'));

    const stored: string[] = [];
    const result = await drainSpool({
      write: async (entries) => {
        stored.push(...entries.map((entry) => entry.payload.message));
      },
    });

    expect(result.drained).toBe(2);
    expect(result.failed).toBe(0);
    expect(stored).toEqual(['first', 'second']);
    expect(result.backlogRemains).toBe(false);
  });

  it('is a no-op on an empty spool', async () => {
    const result = await drainSpool({
      write: async () => {
        throw new Error('the store must not be touched when there is nothing to drain');
      },
    });

    expect(result.drained).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.batches).toBe(0);
    expect(result.backlogRemains).toBe(false);
  });

  it('drains in batches until the spool is empty', async () => {
    for (let i = 0; i < 10; i++) spoolEvent(payload(`event ${i}`));

    const sizes: number[] = [];
    const result = await drainSpool({
      batchSize: 3,
      write: async (entries) => {
        sizes.push(entries.length);
      },
    });

    expect(result.drained).toBe(10);
    expect(sizes).toEqual([3, 3, 3, 1]);
    expect(result.batches).toBe(4);
    expect(result.backlogRemains).toBe(false);
  });

  it('stops after the bounded number of batches', async () => {
    for (let i = 0; i < 10; i++) spoolEvent(payload(`event ${i}`));

    const result = await drainSpool({
      batchSize: 2,
      maxBatches: 2,
      write: async () => {},
    });

    // A job must not run forever: the rest of the backlog waits for the
    // next drain.
    expect(result.drained).toBe(4);
    expect(result.batches).toBe(2);
    expect(result.backlogRemains).toBe(true);
  });

  it('reports a failed batch and keeps the events queued', async () => {
    spoolEvent(payload('survivor'));

    const result = await drainSpool({
      write: async () => {
        throw new Error('database unavailable');
      },
    });

    expect(result.drained).toBe(0);
    expect(result.failed).toBe(1);
    // The event is still on disk: the drain failed, the event did not.
    expect(result.backlogRemains).toBe(true);
  });
});
