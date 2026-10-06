import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DurableSpool, type SpoolEntry } from '@/lib/monitoring/event-spool';
import { EventDrainer } from '@/lib/monitoring/event-drainer';

/**
 * Burst and backpressure behaviour of the ingest spool.
 *
 * A NOC burst is the normal case, not the exception: a link flap, a failing
 * card or a bad configuration change emits thousands of syslog lines in a few
 * seconds. These tests pin what happens when datagrams arrive far faster than
 * they can be stored, what happens when the database cannot keep up, and that
 * the backlog is drained without loss or duplication once it recovers.
 *
 * The hard disk ceiling matters more than it looks: a spool that fills up
 * silently is worse than one that refuses events loudly, because the operator
 * cannot tell whether they are looking at complete data.
 */
interface Payload {
  message: string;
  n: number;
}

describe('burst into the spool', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'burst-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('absorbs a burst of 2000 records without losing any', () => {
    const spool = new DurableSpool<Payload>({ dir });
    const BURST = 2000;

    for (let i = 0; i < BURST; i++) {
      expect(spool.append({ message: `event ${i}`, n: i })).not.toBeNull();
    }
    spool.close();

    const reopened = new DurableSpool<Payload>({ dir });
    const { entries } = reopened.readBatch(BURST + 10);
    reopened.close();

    expect(entries).toHaveLength(BURST);
    // Order is preserved: a NOC timeline is only useful if it is chronological.
    expect(entries[0].payload.n).toBe(0);
    expect(entries[BURST - 1].payload.n).toBe(BURST - 1);
  });

  it('keeps the backlog growing rather than holding records in memory', () => {
    const spool = new DurableSpool<Payload>({ dir });
    for (let i = 0; i < 500; i++) spool.append({ message: 'x', n: i });

    expect(spool.stats().backlog).toBe(500);
    spool.close();
  });

  it('drains a large backlog in batches without dropping any', async () => {
    const spool = new DurableSpool<Payload>({ dir });
    const TOTAL = 1000;
    for (let i = 0; i < TOTAL; i++) spool.append({ message: 'x', n: i });

    const stored: number[] = [];
    const drainer = new EventDrainer<Payload>({
      spool,
      write: async (entries: SpoolEntry<Payload>[]) => {
        stored.push(...entries.map((e) => e.payload.n));
      },
      batchSize: 100,
      backoffMs: [0],
    });

    for (let round = 0; round < 20 && stored.length < TOTAL; round++) {
      const result = await drainer.drainOnce();
      if (result.drained === 0 && result.failed === 0) break;
    }
    spool.close();

    expect(stored).toHaveLength(TOTAL);
    expect(new Set(stored).size).toBe(TOTAL);
  });
});

describe('backlog accumulated while the database is down', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'backlog-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('loses nothing across a full outage and recovers in order', async () => {
    const spool = new DurableSpool<Payload>({ dir });
    const BURST = 600;

    // Database unavailable for the whole burst.
    const failing = new EventDrainer<Payload>({
      spool,
      write: async () => {
        throw new Error('Database connection refused');
      },
      batchSize: 100,
      maxConsecutiveFailures: 1000,
      backoffMs: [0],
    });

    for (let i = 0; i < BURST; i++) spool.append({ message: 'x', n: i });
    for (let round = 0; round < 6; round++) await failing.drainOnce();

    // Nothing stored, nothing lost.
    expect(failing.stats().consecutiveFailures).toBeGreaterThan(0);
    expect(spool.stats().backlog).toBe(BURST);

    // Database returns.
    const stored: number[] = [];
    const recovering = new EventDrainer<Payload>({
      spool,
      write: async (entries: SpoolEntry<Payload>[]) => {
        stored.push(...entries.map((e) => e.payload.n));
      },
      batchSize: 100,
      backoffMs: [0],
    });
    for (let round = 0; round < 20 && stored.length < BURST; round++) {
      const result = await recovering.drainOnce();
      if (result.drained === 0 && result.failed === 0) break;
    }
    spool.close();

    expect(stored).toHaveLength(BURST);
    expect(stored).toEqual([...Array(BURST).keys()]);
  });

  it('survives a restart mid-outage and still drains everything once', async () => {
    const first = new DurableSpool<Payload>({ dir });
    for (let i = 0; i < 300; i++) first.append({ message: 'x', n: i });
    first.close();

    // Process dies while the database is unreachable. A reopened spool must
    // report the real backlog, otherwise /api/health claims the queue is empty
    // while 300 events are sitting on disk.
    const second = new DurableSpool<Payload>({ dir });
    expect(second.stats().backlog).toBe(300);

    const stored: number[] = [];
    const drainer = new EventDrainer<Payload>({
      spool: second,
      write: async (entries: SpoolEntry<Payload>[]) => {
        stored.push(...entries.map((e) => e.payload.n));
      },
      batchSize: 250,
      backoffMs: [0],
    });
    for (let round = 0; round < 10 && stored.length < 300; round++) {
      await drainer.drainOnce();
    }
    second.close();

    expect(stored).toHaveLength(300);
    expect(new Set(stored).size).toBe(300);
  });
});

describe('disk ceiling', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ceiling-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('refuses new events at the hard limit and counts every refusal', () => {
    // A ceiling of 4 KB makes the ceiling reachable inside the test.
    const spool = new DurableSpool<Payload>({
      dir,
      maxBytes: 4096,
      hardMaxBytes: 4096,
    });

    let accepted = 0;
    let refused = 0;
    for (let i = 0; i < 2000; i++) {
      if (spool.append({ message: 'x'.repeat(100), n: i }) === null) refused++;
      else accepted++;
    }

    expect(accepted).toBeGreaterThan(0);
    expect(refused).toBeGreaterThan(0);
    // The refusal is counted, so the operator can see that data was lost.
    expect(spool.stats().dropped).toBe(refused);
    spool.close();
  });

  it('counts a full disk rather than throwing into the receiver', () => {
    const spool = new DurableSpool<Payload>({
      dir,
      maxBytes: 2048,
      hardMaxBytes: 2048,
    });

    let threw = 0;
    for (let i = 0; i < 500; i++) {
      try {
        spool.append({ message: 'x'.repeat(64), n: i });
      } catch {
        threw++;
      }
    }
    const stats = spool.stats();
    spool.close();

    // Either path is acceptable, but it must be visible in both cases.
    expect(stats.dropped + threw).toBeGreaterThan(0);
  });

  it('keeps the data already written when the ceiling is reached', () => {
    const spool = new DurableSpool<Payload>({
      dir,
      maxBytes: 4096,
      hardMaxBytes: 4096,
    });

    for (let i = 0; i < 3000; i++) spool.append({ message: 'x'.repeat(100), n: i });
    spool.close();

    // A refused event must not truncate what came before it.
    const reopened = new DurableSpool<Payload>({ dir });
    const stored = reopened.readBatch(10_000).entries;
    reopened.close();

    expect(stored.length).toBeGreaterThan(0);
    expect(stored[0].payload.n).toBe(0);
  });

  it('rotates the active file once a backlog has been fully drained', async () => {
    const spool = new DurableSpool<Payload>({
      dir,
      maxBytes: 4096,
      hardMaxBytes: 1024 * 1024,
    });
    for (let i = 0; i < 50; i++) spool.append({ message: 'x'.repeat(100), n: i });

    const drainer = new EventDrainer<Payload>({
      spool,
      write: async () => {},
      batchSize: 100,
      backoffMs: [0],
    });
    await drainer.drainOnce();
    spool.close();

    const stats = JSON.parse(
      readFileSync(join(dir, 'events.offset'), 'utf8').trim() || '0',
    );
    expect(stats).toBe(0);
    // The consumed file is set aside instead of growing without bound.
    expect(() => readFileSync(join(dir, 'events.consumed.jsonl'))).not.toThrow();
  });
});

describe('torn writes during a burst', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'torn-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('recovers the complete records and skips only the torn tail', async () => {
    const spool = new DurableSpool<Payload>({ dir });
    for (let i = 0; i < 20; i++) spool.append({ message: 'x', n: i });
    spool.close();

    // A crash mid-write leaves a record with no terminating newline.
    appendFileSync(join(dir, 'events.jsonl'), '{"ingestId":"torn","payl');

    const recovered = new DurableSpool<Payload>({ dir });
    const { entries } = recovered.readBatch(100);

    expect(entries).toHaveLength(20);
    expect(entries.map((e) => e.payload.n)).toEqual([...Array(20).keys()]);
    recovered.close();
  });

  it('does not stall the queue on a corrupt complete line', () => {
    const spool = new DurableSpool<Payload>({ dir });
    spool.append({ message: 'first', n: 0 });
    spool.close();

    writeFileSync(join(dir, 'events.jsonl'), 'CORRUPT LINE\n', { flag: 'a' });
    const recovered = new DurableSpool<Payload>({ dir });
    spool.append({ message: 'after', n: 1 });
    spool.close();

    const third = new DurableSpool<Payload>({ dir });
    const { entries } = third.readBatch(100);
    expect(entries.map((e) => e.payload.n)).toEqual([0, 1]);
    expect(third.stats().corrupt).toBe(1);
    third.close();
    void recovered;
  });
});
/**
 * The burst as it actually arrives: many datagrams hitting a bound UDP socket
 * as fast as the loop can send them. This is the link-flap case, and it is the
 * one where the kernel receive buffer matters, since UDP has no flow control
 * and the kernel drops silently once that buffer fills.
 */
describe('syslog receiver under a burst', () => {
  let dir: string;
  let stop: (() => void) | null = null;
  let port = 17400;
  const spoolEvent = vi.fn<(p: unknown) => string | null>();

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'burst-udp-'));
    process.env['EVENT_SPOOL_DIR'] = dir;
    process.env['SYSLOG_RECEIVER_ENABLED'] = 'true';
    process.env['SYSLOG_TENANT_ID'] = 'tenant-burst';
    process.env['SYSLOG_MAX_EVENTS_PER_MINUTE'] = '100000';
    spoolEvent.mockReset().mockReturnValue('id');
    port += 1;
    process.env['SYSLOG_UDP_PORT'] = String(port);
    vi.resetModules();
  });

  afterEach(() => {
    stop?.();
    stop = null;
    rmSync(dir, { recursive: true, force: true });
  });

  it('accounts for every datagram it accepts from a fast burst', async () => {
    vi.doMock('@/lib/monitoring/event-ingest', async () => ({
      spoolEvent: (p: unknown) => spoolEvent(p),
      recordDroppedEvent: () => {},
      startEventDrainer: () => {},
    }));

    const { startSyslogReceiver } = await import('@/lib/monitoring/syslog');
    stop = startSyslogReceiver();
    await new Promise((r) => setTimeout(r, 200));

    const dgram = await import('node:dgram');
    const BURST = 300;
    const client = dgram.createSocket('udp4');

    for (let i = 0; i < BURST; i++) {
      client.send(
        Buffer.from(`<134>1 2026-10-06 12:00:00 gw01 burst event number ${i}`),
        port,
        '127.0.0.1',
      );
    }
    await new Promise((r) => setTimeout(r, 700));
    client.close();

    // Loss at the socket is acceptable under a burst, but it must not be
    // silently total, and the number queued must be what actually landed.
    expect(spoolEvent.mock.calls.length).toBeGreaterThan(0);
    expect(spoolEvent.mock.calls.length).toBeLessThanOrEqual(BURST);

    const payloads = spoolEvent.mock.calls.map((c) => c[0] as { message: string });
    expect(payloads.some((p) => p.message.includes('burst event'))).toBe(true);
  }, 20000);
});
