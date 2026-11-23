import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { EventDrainer, type BatchWriter } from '../../packages/ingest/src/drainer';
import { DurableSpool } from '../../packages/ingest/src/spool';
import type { DeviceEventPayload } from '../../packages/ingest/src/ingest';
import { withTenants } from './database';
import { runPhases } from './runner';
import type { Phase } from './profiles';

type Payload = DeviceEventPayload & { occurredAt: Date };
const drainIntervalMs = 50;
const operationName = 'spool append → batch write → checkpoint';

async function measure(
  phases: Phase[],
  tenantIds: string[],
  write: BatchWriter<Payload>,
  verify: (persisted: ReadonlyMap<string, string>) => Promise<boolean>,
) {
  const directory = await mkdtemp(join(tmpdir(), 'ftth-perf-'));
  let spool: DurableSpool<Payload> | undefined;
  try {
    const queue = spool = new DurableSpool<Payload>({ dir: directory });
    const pending = new Map<string, { tenantId: string; resolve: (error?: string) => void }>();
    const committed = new Map<string, string>();
    let acknowledgements: string[] = [];
    let drainError: string | undefined;
    let stopped = false;
    let peakBacklog = 0;

    const drainer = new EventDrainer<Payload>({
      spool: queue,
      write: async (entries) => {
        for (const { ingestId, payload } of entries) {
          if (pending.get(ingestId)?.tenantId !== payload.tenantId || committed.has(ingestId)) {
            throw new Error('Ingest identity mismatch');
          }
        }
        await write(entries);
        acknowledgements = entries.map(({ ingestId }) => ingestId);
      },
    });

    const draining = (async () => {
      while (!stopped) {
        await delay(drainIntervalMs);
        if (stopped || pending.size === 0) continue;
        const result = await drainer.drainOnce();
        if (result.drained === 0 || result.failed || result.quarantined || result.drained !== acknowledgements.length) {
          throw new Error('Batch write or checkpoint failed');
        }
        for (const id of acknowledgements) {
          const event = pending.get(id);
          if (!event) throw new Error('Unexpected ingest acknowledgement');
          committed.set(id, event.tenantId);
          event.resolve();
          pending.delete(id);
        }
        acknowledgements = [];
      }
    })().catch(() => {
      drainError = 'ingest drain failed';
      for (const { resolve } of pending.values()) resolve(drainError);
      pending.clear();
    });

    let pass: boolean;
    try {
      pass = await runPhases(phases, [operationName], 1_024, async (index) => {
        if (drainError) return drainError;
        const tenantId = tenantIds[index % tenantIds.length];
        const id = queue.append({
          tenantId, sourceIp: '198.51.100.10', category: 'access',
          message: `Synthetic device event ${index}`, occurredAt: new Date(),
        });
        if (!id) return 'spool refused event';
        if (pending.has(id) || committed.has(id)) return 'duplicate ingest ID';

        return new Promise<string | undefined>((resolve) => {
          pending.set(id, { tenantId, resolve });
          peakBacklog = Math.max(peakBacklog, pending.size);
        });
      });
    } finally {
      stopped = true;
      await draining;
    }
    const expected = phases.reduce((total, phase) => total + phase.seconds * phase.perSecond, 0);
    const { backlog, dropped, corrupt, deadLettered } = queue.stats();
    const sinkMatches = await verify(committed);
    const integrity = committed.size === expected && sinkMatches
      && backlog === 0 && dropped === 0 && corrupt === 0 && deadLettered === 0;
    console.log(JSON.stringify({
      committed: committed.size, expected, peakBacklog, backlog, dropped, corrupt, deadLettered,
      sinkMatches, pass: integrity,
    }));
    return pass && integrity;
  } finally {
    try {
      spool?.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}

export function runSpool(phases: Phase[]) {
  const events = new Map<string, string>();
  return measure(phases, ['perf-test-north', 'perf-test-south'], async (entries) => {
    for (const { ingestId, payload } of entries) events.set(ingestId, payload.tenantId);
  }, async (committed) => events.size === committed.size && [...events].every(
    ([id, tenantId]) => committed.get(id) === tenantId,
  ));
}

export function runPostgresIngest(phases: Phase[]) {
  return withTenants(2, async ({ prisma }, tenantIds) => {
    const { ingestEvents } = await import('../../packages/soc/src/ingest');
    return measure(phases, tenantIds, async (entries) => {
      // The spool encodes Date fields as strings in JSONL. Accept the same
      // payload that the production drainer passes to the batch writer.
      await ingestEvents(entries.map(({ payload, ingestId }) => ({ ...payload, ingestId })));
    }, async (committed) => {
      const rows = await prisma.deviceEvent.findMany({
        where: { tenantId: { in: tenantIds } },
        select: { ingestId: true, tenantId: true },
      });
      return rows.length === committed.size && rows.every(
        ({ ingestId, tenantId }) => ingestId !== null && committed.get(ingestId) === tenantId,
      );
    });
  });
}
