import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@ftth-copilot/db';
import { expireStaleRuns, failInvestigation } from '../src/complete';

/**
 * Cierre de investigaciones contra un Postgres real.
 *
 * El caso que estos tests protegen es el bug que ya estaba en `main`: un run
 * que no cierra queda `pending` para siempre y el incidente no se puede volver
 * a investigar.
 *
 * Necesitan una base: se saltean si `DATABASE_URL` no apunta a Postgres.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const suite = DATABASE_URL?.startsWith('postgres') ? describe : describe.skip;

const TENANT = 'it-investigations';

async function seedRun(runId: string, status: string, requestedAt: Date): Promise<void> {
  await prisma.investigationRun.create({
    data: {
      tenantId: TENANT,
      runId,
      status,
      requestedByUserId: 'it-user',
      requestedAt,
    },
  });
}

async function statusOf(runId: string): Promise<string | undefined> {
  const row = await prisma.investigationRun.findFirst({
    where: { tenantId: TENANT, runId },
    select: { status: true },
  });
  return row?.status;
}

suite('investigation closure', () => {
  beforeAll(async () => {
    await prisma.tenant.upsert({
      where: { slug: TENANT },
      update: {},
      create: { id: TENANT, name: 'Investigations integration', slug: TENANT },
    });
    await prisma.user.upsert({
      where: { id: 'it-user' },
      update: {},
      create: {
        id: 'it-user',
        tenantId: TENANT,
        email: 'it-user@example.test',
        passwordHash: 'x',
        role: 'MEMBER',
      },
    });
  });

  beforeEach(async () => {
    await prisma.investigationRun.deleteMany({ where: { tenantId: TENANT } });
  });

  afterAll(async () => {
    await prisma.investigationRun.deleteMany({ where: { tenantId: TENANT } });
    await prisma.user.deleteMany({ where: { id: 'it-user' } });
    await prisma.tenant.deleteMany({ where: { id: TENANT } });
  });

  it('leaves the run failed, so the incident can be investigated again', async () => {
    await seedRun('run-fail', 'pending', new Date());

    await failInvestigation({ tenantId: TENANT, runId: 'run-fail', reason: 'pipeline exploded' });

    expect(await statusOf('run-fail')).toBe('failed');
  });

  it('only touches the run of the given tenant', async () => {
    await seedRun('run-other', 'pending', new Date());

    await failInvestigation({ tenantId: 'another-tenant', runId: 'run-other', reason: 'x' });

    expect(await statusOf('run-other')).toBe('pending');
  });

  it('expires a pending run older than the TTL', async () => {
    const old = new Date(Date.now() - 60 * 60 * 1000);
    await seedRun('run-old', 'pending', old);

    const expired = await expireStaleRuns({ ttlMs: 15 * 60 * 1000 });

    expect(expired).toBeGreaterThanOrEqual(1);
    expect(await statusOf('run-old')).toBe('expired');
  });

  it('leaves a recent pending run alone', async () => {
    await seedRun('run-fresh', 'pending', new Date());

    await expireStaleRuns({ ttlMs: 15 * 60 * 1000 });

    expect(await statusOf('run-fresh')).toBe('pending');
  });

  it('never touches a run that already reached a final state', async () => {
    const old = new Date(Date.now() - 60 * 60 * 1000);
    await seedRun('run-ready', 'ready', old);
    await seedRun('run-failed', 'failed', old);

    await expireStaleRuns({ ttlMs: 15 * 60 * 1000 });

    expect(await statusOf('run-ready')).toBe('ready');
    expect(await statusOf('run-failed')).toBe('failed');
  });
});
