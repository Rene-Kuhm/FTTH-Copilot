import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@ftth-copilot/db';
import { claimInvestigationAttempt } from '../src/claim';

/**
 * Arranque atómico de un intento, contra un Postgres real.
 *
 * El caso central: dos pedidos simultáneos para el mismo incidente arrancan
 * UN solo intento. Sin el lock, los dos ven "no hay run" y crean dos filas.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const suite = DATABASE_URL?.startsWith('postgres') ? describe : describe.skip;

const TENANT = 'it-claim';
const USER = 'it-claim-user';
const INCIDENT = 'inc-claim';

function claim(refresh = false) {
  return claimInvestigationAttempt({
    tenantId: TENANT,
    incidentId: INCIDENT,
    connectionId: null,
    userId: USER,
    refresh,
  });
}

async function runsOfIncident() {
  return prisma.investigationRun.findMany({
    where: { tenantId: TENANT, incidentId: INCIDENT },
    select: { runId: true, status: true, currentVersionId: true, attemptStartedAt: true },
  });
}

suite('claimInvestigationAttempt', () => {
  beforeAll(async () => {
    await prisma.tenant.upsert({
      where: { slug: TENANT },
      update: {},
      create: { id: TENANT, name: TENANT, slug: TENANT },
    });
    await prisma.user.upsert({
      where: { id: USER },
      update: {},
      create: { id: USER, tenantId: TENANT, email: 'claim@example.test', passwordHash: 'x', role: 'MEMBER' },
    });
  });

  beforeEach(async () => {
    await prisma.investigationRun.deleteMany({ where: { tenantId: TENANT } });
  });

  afterAll(async () => {
    await prisma.investigationRun.deleteMany({ where: { tenantId: TENANT } });
    await prisma.user.deleteMany({ where: { id: USER } });
    await prisma.tenant.deleteMany({ where: { id: TENANT } });
    await prisma.$disconnect();
  });

  it('starts a new attempt with its version and start time', async () => {
    const outcome = await claim();

    expect(outcome.kind).toBe('claimed');
    const [run] = await runsOfIncident();
    expect(run?.status).toBe('pending');
    expect(outcome.kind === 'claimed' && run?.currentVersionId).toBe(
      outcome.kind === 'claimed' ? outcome.versionId : null,
    );
    expect(run?.attemptStartedAt).toBeInstanceOf(Date);
  });

  it('two simultaneous requests start a single attempt on a single row', async () => {
    // Every request reads, then waits 150 ms before writing: without the lock
    // all of them read "no run" and each creates its own row.
    const slow = () =>
      claimInvestigationAttempt({
        tenantId: TENANT,
        incidentId: INCIDENT,
        connectionId: null,
        userId: USER,
        refresh: false,
        betweenReadAndWrite: () => new Promise((resolve) => setTimeout(resolve, 150)),
      });
    const outcomes = await Promise.all([slow(), slow(), slow(), slow()]);

    expect(outcomes.filter((o) => o.kind === 'claimed')).toHaveLength(1);
    expect(outcomes.filter((o) => o.kind === 'pending')).toHaveLength(3);
    expect(await runsOfIncident()).toHaveLength(1);
  });

  it('does not start another attempt while one is pending', async () => {
    const first = await claim();
    const second = await claim(true);

    expect(second).toEqual({ kind: 'pending', runId: first.runId });
  });

  it('returns the ready result unless a refresh is requested', async () => {
    const first = await claim();
    await prisma.investigationRun.updateMany({ where: { tenantId: TENANT }, data: { status: 'ready' } });

    expect(await claim()).toEqual({ kind: 'ready', runId: first.runId });

    const refreshed = await claim(true);
    expect(refreshed.kind).toBe('claimed');
    expect(refreshed.runId).toBe(first.runId);
  });

  it('starts a fresh attempt on the same row after failed or expired', async () => {
    const first = await claim();
    for (const status of ['failed', 'expired']) {
      await prisma.investigationRun.updateMany({ where: { tenantId: TENANT }, data: { status } });

      const next = await claim();

      expect(next.kind).toBe('claimed');
      expect(next.runId).toBe(first.runId);
      expect(next.kind === 'claimed' && first.kind === 'claimed' && next.versionId !== first.versionId).toBe(
        true,
      );
    }
    expect(await runsOfIncident()).toHaveLength(1);
  });
});
