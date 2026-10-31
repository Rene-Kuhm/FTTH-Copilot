import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DurableSpool } from '../src/spool';
import { EventDrainer } from '../src/drainer';

interface Payload {
  message: string;
  severity?: number;
}

describe('DurableSpool', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'spool-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('round-trips appended records', () => {
    const spool = new DurableSpool<Payload>({ dir });
    spool.append({ message: 'link down' });
    spool.append({ message: 'link up', severity: 5 });
    spool.close();

    const { entries } = spool.readBatch(10);
    expect(entries.map((e) => e.payload.message)).toEqual(['link down', 'link up']);
    expect(entries[1].payload.severity).toBe(5);
  });

  it('assigns a unique id per record', () => {
    const spool = new DurableSpool<Payload>({ dir });
    spool.append({ message: 'a' });
    spool.append({ message: 'b' });
    spool.close();

    const { entries } = spool.readBatch(10);
    expect(new Set(entries.map((e) => e.ingestId)).size).toBe(2);
  });

  it('survives a restart and resumes from the committed offset', () => {
    const first = new DurableSpool<Payload>({ dir });
    first.append({ message: 'one' });
    first.append({ message: 'two' });

    const { nextOffset } = first.readBatch(1);
    first.commit(nextOffset, 1);
    first.close();

    const second = new DurableSpool<Payload>({ dir });
    const { entries } = second.readBatch(10);
    expect(entries.map((e) => e.payload.message)).toEqual(['two']);
    second.close();
  });

  it('replays uncommitted records after a crash, so dedup can absorb them', () => {
    const first = new DurableSpool<Payload>({ dir });
    first.append({ message: 'one' });
    const batch = first.readBatch(10);
    // Simulate a crash after read but before commit: the offset never moved.
    first.close();

    const second = new DurableSpool<Payload>({ dir });
    const replay = second.readBatch(10);
    expect(replay.entries.map((e) => e.ingestId)).toEqual(
      batch.entries.map((e) => e.ingestId),
    );
    second.close();
  });

  it('keeps ids stable across a restart so a replay stays deduplicable', () => {
    const first = new DurableSpool<Payload>({ dir });
    first.append({ message: 'one' });
    const before = first.readBatch(10).entries[0].ingestId;
    first.close();

    const second = new DurableSpool<Payload>({ dir });
    expect(second.readBatch(10).entries[0].ingestId).toBe(before);
    second.close();
  });

  it('ignores a partial trailing line left by a crash mid-write', () => {
    const spool = new DurableSpool<Payload>({ dir });
    spool.append({ message: 'complete' });
    spool.close();

    // Simulate a torn write: a line with no terminating newline.
    writeFileSync(join(dir, 'events.jsonl'), '{"ingestId":"x","payload":{"mess', {
      flag: 'a',
    });

    const recovered = new DurableSpool<Payload>({ dir });
    const { entries } = recovered.readBatch(10);
    expect(entries.map((e) => e.payload.message)).toEqual(['complete']);
    recovered.close();
  });

  it('counts corrupt lines instead of stalling the queue', () => {
    const spool = new DurableSpool<Payload>({ dir });
    spool.append({ message: 'good' });
    spool.close();

    writeFileSync(join(dir, 'events.jsonl'), 'not json at all\n', { flag: 'a' });

    const recovered = new DurableSpool<Payload>({ dir });
    const { entries } = recovered.readBatch(10);
    expect(entries.map((e) => e.payload.message)).toEqual(['good']);
    expect(recovered.stats().corrupt).toBe(1);
    recovered.close();
  });

  it('refuses new records past the hard limit and counts the drop', () => {
    const spool = new DurableSpool<Payload>({
      dir,
      maxBytes: 1024,
      hardMaxBytes: 1024,
    });
    let refused = 0;
    for (let i = 0; i < 200; i++) {
      if (spool.append({ message: 'x'.repeat(64) }) === null) refused++;
    }

    // A refused append must be visible, not silent: an operator has to be
    // able to tell that events are being dropped.
    expect(refused).toBeGreaterThan(0);
    expect(spool.stats().dropped).toBe(refused);
    spool.close();
  });

  it('reports backlog, drops and quarantine counts', () => {
    const spool = new DurableSpool<Payload>({ dir });
    spool.append({ message: 'a' });
    spool.append({ message: 'b' });
    spool.close();

    const stats = spool.stats();
    expect(stats.backlog).toBe(2);
    expect(stats.dropped).toBe(0);
    expect(stats.deadLettered).toBe(0);
  });
});

describe('EventDrainer', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'drain-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const noBackoff = [0];

  it('drains a batch and advances the offset', async () => {
    const spool = new DurableSpool<Payload>({ dir });
    spool.append({ message: 'a' });
    spool.append({ message: 'b' });

    const written: string[][] = [];
    const drainer = new EventDrainer<Payload>({
      spool,
      write: async (entries) => {
        written.push(entries.map((e) => e.payload.message));
      },
      backoffMs: noBackoff,
    });

    const result = await drainer.drainOnce();
    spool.close();

    expect(result.drained).toBe(2);
    expect(written).toEqual([['a', 'b']]);
    expect(spool.stats().backlog).toBe(0);
  });

  it('does not advance the offset when the write fails', async () => {
    const spool = new DurableSpool<Payload>({ dir });
    spool.append({ message: 'a' });

    const drainer = new EventDrainer<Payload>({
      spool,
      write: async () => {
        throw new Error('database unavailable');
      },
      backoffMs: noBackoff,
    });

    const result = await drainer.drainOnce();
    spool.close();

    expect(result.failed).toBe(1);
    // The record is still queued, which is the whole point of the spool.
    expect(spool.stats().backlog).toBe(1);
  });

  it('recovers once the database comes back', async () => {
    const spool = new DurableSpool<Payload>({ dir });
    spool.append({ message: 'survived' });

    let healthy = false;
    const drainer = new EventDrainer<Payload>({
      spool,
      write: async () => {
        if (!healthy) throw new Error('down');
      },
      backoffMs: noBackoff,
    });

    await drainer.drainOnce();
    expect(spool.stats().backlog).toBe(1);

    healthy = true;
    const result = await drainer.drainOnce();
    spool.close();

    expect(result.drained).toBe(1);
    expect(spool.stats().backlog).toBe(0);
  });

  it('never dead-letters a batch that fails for an unclassified reason', async () => {
    const spool = new DurableSpool<Payload>({ dir });
    spool.append({ message: 'poison' });

    const drainer = new EventDrainer<Payload>({
      spool,
      // No `code`: the reason cannot be classified, so it must be retried.
      write: async () => {
        throw new Error('permanently broken');
      },
      backoffMs: noBackoff,
    });

    // However many times it fails, nothing is dead-lettered and the event
    // stays on disk: a wrong guess loses telemetry, a retry only delays it.
    for (let i = 0; i < 20; i++) await drainer.drainOnce();
    spool.close();

    expect(existsSync(join(dir, 'events.dlq.jsonl'))).toBe(false);
    expect(spool.stats().backlog).toBe(1);
  });

  it('dead-letters a single event that can never be stored, and stores the rest', async () => {
    const spool = new DurableSpool<Payload>({ dir });
    spool.append({ message: 'good-before' });
    spool.append({ message: 'poison' });
    spool.append({ message: 'good-after' });

    const stored: string[] = [];
    const drainer = new EventDrainer<Payload>({
      spool,
      write: async (entries) => {
        for (const entry of entries) {
          if (entry.payload.message === 'poison') {
            throw Object.assign(new Error('foreign key violated'), { code: 'P2003' });
          }
          stored.push(entry.payload.message);
        }
      },
      backoffMs: noBackoff,
    });

    const result = await drainer.drainOnce();
    spool.close();

    expect(result.quarantined).toBe(1);
    // The events behind the poisonous one are not blocked by it.
    expect(stored).toContain('good-before');
    expect(stored).toContain('good-after');

    const dlq = readFileSync(join(dir, 'events.dlq.jsonl'), 'utf8');
    expect(dlq).toContain('poison');
    expect(dlq).toContain('foreign key violated');
    expect(dlq).not.toContain('good-before');
    expect(spool.stats().backlog).toBe(0);
  });

  it('stops the per-event retry when the store goes down mid-batch', async () => {
    const spool = new DurableSpool<Payload>({ dir });
    spool.append({ message: 'poison' });
    spool.append({ message: 'kept-on-disk' });

    let downAfterFirst = false;
    const drainer = new EventDrainer<Payload>({
      spool,
      write: async (entries) => {
        const message = entries[0]!.payload.message;
        if (message === 'poison') {
          throw Object.assign(new Error('foreign key violated'), { code: 'P2003' });
        }
        // The database goes down right after the poisonous event is handled.
        downAfterFirst = true;
        throw Object.assign(new Error('connection refused'), { code: 'P1001' });
      },
      backoffMs: noBackoff,
    });

    const result = await drainer.drainOnce();
    const backlog = spool.stats().backlog;
    spool.close();

    expect(downAfterFirst).toBe(true);
    expect(result.quarantined).toBe(1);
    expect(result.failed).toBe(1);
    // The event after the outage stays on disk: it is not lost.
    expect(backlog).toBe(1);
    const dlq = readFileSync(join(dir, 'events.dlq.jsonl'), 'utf8');
    expect(dlq).not.toContain('kept-on-disk');
  });

  it('defers while backing off so a failing database is not hammered', async () => {
    const spool = new DurableSpool<Payload>({ dir });
    spool.append({ message: 'a' });

    let attempts = 0;
    const drainer = new EventDrainer<Payload>({
      spool,
      write: async () => {
        attempts++;
        throw new Error('down');
      },
      backoffMs: [60_000],
    });

    await drainer.drainOnce();
    const deferred = await drainer.drainOnce();
    spool.close();

    expect(deferred.deferred).toBe(true);
    expect(attempts).toBe(1);
  });

  it('writes batches of the configured size', async () => {
    const spool = new DurableSpool<Payload>({ dir });
    for (let i = 0; i < 10; i++) spool.append({ message: `e${i}` });

    const sizes: number[] = [];
    const drainer = new EventDrainer<Payload>({
      spool,
      write: async (entries) => {
        sizes.push(entries.length);
      },
      batchSize: 4,
      backoffMs: noBackoff,
    });

    await drainer.drainOnce();
    await drainer.drainOnce();
    await drainer.drainOnce();
    spool.close();

    expect(sizes).toEqual([4, 4, 2]);
  });

  it('never overlaps two drains', async () => {
    const spool = new DurableSpool<Payload>({ dir });
    spool.append({ message: 'a' });

    let concurrent = 0;
    let overlapped = false;
    const drainer = new EventDrainer<Payload>({
      spool,
      write: async () => {
        concurrent++;
        if (concurrent > 1) overlapped = true;
        await new Promise((resolve) => setTimeout(resolve, 5));
        concurrent--;
      },
      backoffMs: noBackoff,
    });

    await Promise.all([drainer.drainOnce(), drainer.drainOnce()]);
    spool.close();

    expect(overlapped).toBe(false);
  });
});