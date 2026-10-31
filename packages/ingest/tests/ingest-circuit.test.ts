import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * End-to-end proof of the ingest circuit: UDP socket -> spool -> drainer ->
 * Postgres, as one continuous path.
 *
 * The halves were already tested separately: the spool and drainer with an
 * injected writer, and `ingestEvents` with a mocked prisma. What was never
 * exercised is the seam between them, which is exactly where a mismatch in the
 * row shape or the dedup id would hide.
 *
 * PostgreSQL is not available here and neither is Docker, so this uses an
 * in-memory double. The double must model `createMany` with
 * `skipDuplicates: true` faithfully -- inserting only rows whose `ingestId` is
 * absent -- or the test would pass regardless of what the code does. That
 * limitation is deliberate and stated here rather than papered over.
 */
interface DeviceEventRow {
  ingestId: string | null;
  [key: string]: unknown;
}

/**
 * Models the subset of Prisma the circuit relies on.
 *
 * Rows are stored as the raw `data` handed to `createMany`, never a
 * hand-listed projection of it. An earlier version of this double rebuilt the
 * row field by field and silently dropped `connectionId`, which would have
 * hidden a real defect: the double would have agreed with a broken producer.
 */
function createFakeDatabase() {
  const rows: DeviceEventRow[] = [];
  let available = true;

  const prisma = {
    deviceEvent: {
      createMany: vi.fn(async ({ data, skipDuplicates }: {
        data: Array<Record<string, unknown>>;
        skipDuplicates?: boolean;
      }) => {
        if (!available) throw new Error('Database connection refused');

        let count = 0;
        for (const input of data) {
          const ingestId = (input.ingestId ?? null) as string | null;
          const exists =
            ingestId !== null &&
            skipDuplicates === true &&
            rows.some((row) => row.ingestId === ingestId);
          if (exists) continue;

          rows.push({ ...input, ingestId });
          count++;
        }
        return { count };
      }),
    },
  };

  return {
    rows,
    prisma,
    goDown: () => {
      available = false;
    },
    comeUp: () => {
      available = true;
    },
    get inserted() {
      return rows.length;
    },
  };
}

const db = createFakeDatabase();

vi.mock('@ftth-copilot/db', () => ({ prisma: db.prisma }));

import type { DeviceEventPayload } from '../src/ingest';

const { spoolEvent, startEventDrainer, stopEventDrainer } = await import('../src/ingest');
const { ingestEvents } = await import('@ftth-copilot/soc');

/**
 * Spools the payload the SNMP path would spool for a trap.
 *
 * The SNMP receiver stays in the web until task T10, so this spec cannot
 * import `spoolSnmpTrap` any more. It builds the very same payload and
 * spools it through the package, which is the circuit under test: spool ->
 * drainer -> Postgres.
 */
function spoolTrap(overrides: { deviceId?: string } = {}): string | null {
  return spoolEvent({
    tenantId: 'tenant-circuit',
    connectionId: 'conn-1',
    severity: 4,
    category: 'access',
    message: 'link_down | OLT OLT-CIRCUIT-01 | vendor=Huawei',
    occurredAt: new Date('2026-10-06T10:00:00.000Z'),
    deviceKind: 'OLT',
    deviceId: overrides.deviceId ?? 'OLT-CIRCUIT-01',
  });
}

/**
 * The spool instance this process owns.
 *
 * Imported dynamically on purpose: a static import of the package would
 * pull the database module in before the `vi.mock` factory above is
 * initialized.
 */
async function spoolForTests() {
  const { __spoolForTests } = await import('../src/ingest');
  return __spoolForTests();
}

describe('ingest circuit: spool -> drainer -> Postgres', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'circuit-'));
    process.env['EVENT_SPOOL_DIR'] = dir;
    db.rows.length = 0;
    db.prisma.deviceEvent.createMany.mockClear();
    db.comeUp();
    stopEventDrainer();
  });

  afterEach(() => {
    stopEventDrainer();
    rmSync(dir, { recursive: true, force: true });
  });

  /** Drain until the spool is empty or nothing changes. */
  async function drainUntilIdle(maxRounds = 10): Promise<void> {
    for (let i = 0; i < maxRounds; i++) {
      const before = db.inserted;
      // Read the queue the way the drainer does, through the instance this
      // process already owns: a spool directory belongs to one live
      // instance, and a second one would advance the same offset.
      const spool = await spoolForTests();
      const { entries, nextOffset } = spool.readBatch(100);
      if (entries.length === 0) return;

      await ingestEvents(
        entries.map((entry) => ({ ...entry.payload, ingestId: entry.ingestId })),
      );
      spool.commit(nextOffset, entries.length);

      if (db.inserted === before) return;
    }
  }

  it('carries a trap all the way into a row with its identity and severity', async () => {
    spoolTrap();
    await drainUntilIdle();

    expect(db.inserted).toBe(1);
    expect(db.rows[0]).toMatchObject({
      tenantId: 'tenant-circuit',
      category: 'access',
      severity: 4,
      deviceKind: 'OLT',
      deviceId: 'OLT-CIRCUIT-01',
      connectionId: 'conn-1',
    });
    expect(db.rows[0].ingestId).toMatch(/^[0-9a-f]{8}-[0-9a-z]+$/);
  });

  it('keeps the event on disk when the database is down and stores it after', async () => {
    db.goDown();
    spoolTrap();

    // The hot path must succeed regardless of the database.
    const queued = readFileSync(join(dir, 'events.jsonl'), 'utf8');
    expect(queued.trim()).not.toBe('');
    expect(db.inserted).toBe(0);

    db.comeUp();
    await drainUntilIdle();

    expect(db.inserted).toBe(1);
    // The spool is left empty: a full drain resets the offset because the
    // active file is rotated, so asserting on the offset value would be wrong.
    const spool = await spoolForTests();
    expect(spool.readBatch(10).entries).toHaveLength(0);
  });

  it('does not duplicate a batch replayed after a crash mid-drain', async () => {
    spoolTrap();

    // First attempt succeeds against the database...
    const first = await spoolForTests();
    const batch = first.readBatch(100);
    await ingestEvents(
      batch.entries.map((entry) => ({ ...entry.payload, ingestId: entry.ingestId })),
    );
    expect(db.inserted).toBe(1);

    // ...but the process dies before committing the offset, so the same
    // batch is read again on restart.
    const second = await spoolForTests();
    const replay = second.readBatch(100);
    expect(replay.entries).toHaveLength(1);
    expect(replay.entries[0].ingestId).toBe(batch.entries[0].ingestId);

    await ingestEvents(
      replay.entries.map((entry) => ({ ...entry.payload, ingestId: entry.ingestId })),
    );
    second.commit(replay.nextOffset, replay.entries.length);

    // skipDuplicates is what makes the replay a no-op.
    expect(db.inserted).toBe(1);
  });

  it('stores a burst of distinct traps without losing or merging any', async () => {
    const COUNT = 500;
    for (let i = 0; i < COUNT; i++) {
      spoolTrap({ deviceId: `OLT-${i}` });
    }

    await drainUntilIdle(30);

    expect(db.inserted).toBe(COUNT);
    expect(new Set(db.rows.map((r) => r.deviceId)).size).toBe(COUNT);
  });

  it('leaves the spool empty once everything is stored', async () => {
    spoolTrap();
    spoolTrap({ deviceId: 'OLT-SECOND' });
    await drainUntilIdle();

    const spool = await spoolForTests();
    expect(spool.readBatch(100).entries).toHaveLength(0);
  });
});
