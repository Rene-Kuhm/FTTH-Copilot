import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { EventDrainer } from '../../../../packages/ingest/src/drainer';
import { DurableSpool } from '../../../../packages/ingest/src/spool';
import { runSoak, setting } from './soak';

const TENANT = 'load-spool-tenant';
const PAYLOAD = 'synthetic telemetry from 192.0.2.47 '.repeat(8);
type Payload = { tenantId: string; sequence: number; message: string };

async function stress(spool: DurableSpool<Payload>, dir: string): Promise<void> {
  const started = performance.now();
  const accepted = new Map<string, number>();
  const stored = new Set<string>();
  const poisonSequence = 100;
  let rejected = 0;
  let unavailable = true;
  const drainer = new EventDrainer({
    spool,
    batchSize: 250,
    backoffMs: [25],
    write: async (entries) => {
      if (unavailable) throw Object.assign(new Error('synthetic store outage'), { code: 'P1001' });
      for (const entry of entries) {
        assert.equal(entry.payload.tenantId, TENANT);
        assert.equal(accepted.get(entry.ingestId), entry.payload.sequence);
        if (entry.payload.sequence === poisonSequence) {
          throw Object.assign(new Error('synthetic foreign key violation'), { code: 'P2003' });
        }
      }
      for (const entry of entries) stored.add(entry.ingestId);
    },
  });

  for (let sequence = 0; sequence < 10_000; sequence++) {
    const id = spool.append({ tenantId: TENANT, sequence, message: PAYLOAD });
    if (id === null) rejected++;
    else accepted.set(id, sequence);
  }
  const saturated = spool.stats();
  assert(accepted.size > 250 && rejected > 0);
  assert.equal(saturated.backlog, accepted.size);
  assert.equal(saturated.dropped, rejected);
  assert.equal((await drainer.drainOnce()).failed, 250);
  assert.equal((await drainer.drainOnce(0)).deferred, true);
  assert.equal(spool.stats().deadLettered, 0);
  assert.equal(spool.stats().backlog, accepted.size);

  unavailable = false;
  await delay(30);
  for (let i = 0; i < Math.ceil(accepted.size / 250); i++) {
    assert.equal((await drainer.drainOnce()).failed, 0);
  }
  const final = spool.stats();
  assert.equal(final.backlog, 0);
  assert.equal(final.deadLettered, 1);
  assert.equal(stored.size, accepted.size - 1);
  const dlq = JSON.parse(readFileSync(join(dir, 'events.dlq.jsonl'), 'utf8').trim());
  assert.equal(dlq.payload.tenantId, TENANT);
  assert.equal(dlq.payload.sequence, poisonSequence);
  assert.equal(accepted.get(dlq.ingestId), poisonSequence);
  assert.equal(stored.has(dlq.ingestId), false);
  assert(spool.append({ tenantId: TENANT, sequence: 10_000, message: PAYLOAD }));

  console.log(JSON.stringify({
    label: 'spool-stress', sent: 10_000, accepted: accepted.size, rejected, stored: stored.size,
    bytesAtLimit: saturated.bytes, deadLettered: final.deadLettered, resumedAdmission: true,
    elapsedMs: performance.now() - started,
  }));
}

async function soak(spool: DurableSpool<Payload>): Promise<void> {
  const eventsPerCycle = setting('SOAK_EVENTS_PER_SECOND', 100, 1, 1000);
  let sent = 0;
  let stored = 0;
  const drainer = new EventDrainer({
    spool,
    write: async (entries) => {
      for (const { payload } of entries) {
        assert.equal(payload.tenantId, TENANT);
        assert.equal(payload.sequence, stored++);
      }
    },
  });

  await runSoak('spool-soak', async () => {
    for (let i = 0; i < eventsPerCycle; i++) {
      assert(spool.append({ tenantId: TENANT, sequence: sent++, message: PAYLOAD }));
    }
    for (let i = 0; i < Math.ceil(eventsPerCycle / 250); i++) {
      assert((await drainer.drainOnce()).drained > 0);
    }
    assert.equal(spool.stats().backlog, 0);
    assert.equal(stored, sent);
  });
  console.log(JSON.stringify({ label: 'spool-soak', sent, stored, ...spool.stats() }));
}

const mode = process.argv[2];
assert(mode === 'stress' || mode === 'soak');
const dir = mkdtempSync(join(tmpdir(), 'ftth-spool-load-'));
try {
  const spool = new DurableSpool<Payload>({ dir, hardMaxBytes: 512 * 1024 });
  try {
    await (mode === 'stress' ? stress(spool, dir) : soak(spool));
  } finally {
    spool.close();
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
