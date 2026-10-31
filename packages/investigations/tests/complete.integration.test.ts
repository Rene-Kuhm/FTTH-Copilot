import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@ftth-copilot/db';
import type { InvestigationResult } from '@ftth-copilot/shared';
import {
  beginInvestigationAttempt,
  completeInvestigation,
  expireStaleRuns,
  failInvestigation,
} from '../src/complete';

/**
 * Cierre de investigaciones contra un Postgres real.
 *
 * Protege dos cosas:
 *  - el bug de `main`: un run que no cierra queda `pending` para siempre y el
 *    incidente no se puede volver a investigar;
 *  - los bugs de carrera de la unidad 7b: la fila del run se reutiliza entre
 *    intentos, así que un intento viejo no puede tocar el estado del nuevo y el
 *    barrido tiene que medir la edad del intento, no de la fila.
 *
 * Necesitan una base: se saltean si `DATABASE_URL` no apunta a Postgres.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const suite = DATABASE_URL?.startsWith('postgres') ? describe : describe.skip;

const TENANT = 'it-investigations';
const OTHER_TENANT = 'it-investigations-other';
const USER = 'it-user';
const TTL = 15 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

function resultFor(runId: string, versionId: string): InvestigationResult {
  return {
    schema: 'ftth.investigation-result.v1',
    resultId: `res-${versionId}`,
    runId,
    versionId,
    tenantId: TENANT,
    connectionId: null,
    incidentId: null,
    windowStart: '2026-09-08T00:00:00.000Z',
    windowEnd: '2026-09-09T00:00:00.000Z',
    windowDays: 1,
    cutoffAt: '2026-09-09T00:00:00.000Z',
    rulesetVersion: 'ruleset@1.0.0',
    modelVersion: 'test-model',
    promptVersion: 'prompt@1.0.0',
    evidenceRefs: [],
    hypotheses: [],
    contradictions: [],
    missing: [],
    suggestedChecks: [],
    sufficiency: 'provisional',
    sufficiencyReason: 'test',
    producedAt: '2026-09-09T00:01:00.000Z',
    producedBy: 'agent-core@0.1.0',
  };
}

interface SeedOptions {
  status?: string;
  requestedAt?: Date;
  currentVersionId?: string | null;
  attemptStartedAt?: Date | null;
}

async function seedRun(runId: string, options: SeedOptions = {}): Promise<void> {
  await prisma.investigationRun.create({
    data: {
      tenantId: TENANT,
      runId,
      status: options.status ?? 'pending',
      requestedByUserId: USER,
      requestedAt: options.requestedAt ?? new Date(),
      currentVersionId: options.currentVersionId ?? null,
      attemptStartedAt: options.attemptStartedAt ?? null,
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

function complete(runId: string, versionId: string) {
  return completeInvestigation({
    tenantId: TENANT,
    runId,
    versionId,
    incidentId: 'inc-1',
    userId: USER,
    investigationResult: resultFor(runId, versionId),
    startedAtMs: Date.now(),
  });
}

function fail(runId: string, versionId: string, tenantId = TENANT) {
  return failInvestigation({ tenantId, runId, versionId, userId: USER, reason: 'pipeline exploded' });
}

suite('investigation closure', () => {
  beforeAll(async () => {
    await prisma.tenant.upsert({
      where: { slug: TENANT },
      update: {},
      create: { id: TENANT, name: 'Investigations integration', slug: TENANT },
    });
    await prisma.tenant.upsert({
      where: { slug: OTHER_TENANT },
      update: {},
      create: { id: OTHER_TENANT, name: 'Investigations integration (other)', slug: OTHER_TENANT },
    });
    await prisma.user.upsert({
      where: { id: USER },
      update: {},
      create: {
        id: USER,
        tenantId: TENANT,
        email: 'it-user@example.test',
        passwordHash: 'x',
        role: 'MEMBER',
      },
    });
  });

  beforeEach(async () => {
    await prisma.agentActionLog.deleteMany({ where: { tenantId: TENANT } });
    await prisma.investigationVersion.deleteMany({ where: { tenantId: TENANT } });
    await prisma.investigationRun.deleteMany({ where: { tenantId: TENANT } });
  });

  afterAll(async () => {
    await prisma.agentActionLog.deleteMany({ where: { tenantId: TENANT } });
    await prisma.investigationVersion.deleteMany({ where: { tenantId: TENANT } });
    await prisma.investigationRun.deleteMany({ where: { tenantId: TENANT } });
    await prisma.agentActionLog.deleteMany({ where: { tenantId: OTHER_TENANT } });
    await prisma.user.deleteMany({ where: { id: USER } });
    await prisma.tenant.deleteMany({ where: { id: { in: [TENANT, OTHER_TENANT] } } });
    await prisma.$disconnect();
  });

  describe('completeInvestigation', () => {
    it('stores the version, logs the action and leaves the run ready, all at once', async () => {
      await seedRun('run-ok', { currentVersionId: 'v1', attemptStartedAt: new Date() });

      const result = await complete('run-ok', 'v1');

      expect(result.applied).toBe(true);
      expect(await statusOf('run-ok')).toBe('ready');
      expect(await prisma.investigationVersion.count({ where: { tenantId: TENANT, runId: 'run-ok' } })).toBe(1);
      expect(
        await prisma.agentActionLog.count({ where: { tenantId: TENANT, toolName: '__investigation_open__' } }),
      ).toBe(1);
    });

    it('(b) a late old attempt keeps its version but never marks the new attempt ready', async () => {
      await seedRun('run-race', { currentVersionId: 'v1', attemptStartedAt: new Date() });
      // The user relaunched: v2 is the attempt in flight now.
      await beginInvestigationAttempt({ tenantId: TENANT, runId: 'run-race', versionId: 'v2' });

      const late = await complete('run-race', 'v1');

      expect(late.applied).toBe(false);
      expect(await statusOf('run-race')).toBe('pending');
      // The late result is real and paid for: it stays as history.
      expect(await prisma.investigationVersion.count({ where: { tenantId: TENANT, runId: 'run-race' } })).toBe(1);

      const current = await complete('run-race', 'v2');
      expect(current.applied).toBe(true);
      expect(await statusOf('run-race')).toBe('ready');
    });

    it('rolls everything back when the version is invalid', async () => {
      await seedRun('run-bad', { currentVersionId: 'v1', attemptStartedAt: new Date() });

      await expect(
        completeInvestigation({
          tenantId: TENANT,
          runId: 'run-bad',
          versionId: 'v1',
          incidentId: 'inc-1',
          userId: USER,
          investigationResult: { ...resultFor('run-bad', 'v1'), tenantId: 'someone-else' },
          startedAtMs: Date.now(),
        }),
      ).rejects.toThrow(/Tenant mismatch/);

      expect(await statusOf('run-bad')).toBe('pending');
      expect(await prisma.agentActionLog.count({ where: { tenantId: TENANT } })).toBe(0);
    });
  });

  describe('failInvestigation', () => {
    it('leaves the run failed and records the reason, so the incident can be investigated again', async () => {
      await seedRun('run-fail', { currentVersionId: 'v1', attemptStartedAt: new Date() });

      expect(await fail('run-fail', 'v1')).toBe(true);

      expect(await statusOf('run-fail')).toBe('failed');
      const log = await prisma.agentActionLog.findFirst({
        where: { tenantId: TENANT, toolName: '__investigation_failed__' },
      });
      expect(log?.errorMessage).toBe('pipeline exploded');
    });

    it('(c) a late old attempt that fails never marks the new attempt failed', async () => {
      await seedRun('run-fail-race', { currentVersionId: 'v1', attemptStartedAt: new Date() });
      await beginInvestigationAttempt({ tenantId: TENANT, runId: 'run-fail-race', versionId: 'v2' });

      expect(await fail('run-fail-race', 'v1')).toBe(false);

      expect(await statusOf('run-fail-race')).toBe('pending');
    });

    it('only touches the run of the given tenant', async () => {
      await seedRun('run-other', { currentVersionId: 'v1', attemptStartedAt: new Date() });

      expect(await fail('run-other', 'v1', OTHER_TENANT)).toBe(false);

      expect(await statusOf('run-other')).toBe('pending');
    });
  });

  describe('expireStaleRuns', () => {
    it('expires a pending attempt older than the TTL', async () => {
      await seedRun('run-old', {
        currentVersionId: 'v1',
        attemptStartedAt: new Date(Date.now() - HOUR),
        requestedAt: new Date(Date.now() - HOUR),
      });

      await expireStaleRuns({ ttlMs: TTL });

      expect(await statusOf('run-old')).toBe('expired');
    });

    it('(a) never expires an old run that was relaunched and is still running', async () => {
      // Row created three days ago; the user relaunched it a minute ago.
      await seedRun('run-relaunched', {
        status: 'ready',
        requestedAt: new Date(Date.now() - 72 * HOUR),
      });
      await beginInvestigationAttempt({ tenantId: TENANT, runId: 'run-relaunched', versionId: 'v2' });

      await expireStaleRuns({ ttlMs: TTL });

      expect(await statusOf('run-relaunched')).toBe('pending');
    });

    it('(d) expires an old pending row that has no attempt recorded', async () => {
      // A row stuck before the attemptStartedAt column existed.
      await seedRun('run-legacy', { requestedAt: new Date(Date.now() - HOUR) });

      await expireStaleRuns({ ttlMs: TTL });

      expect(await statusOf('run-legacy')).toBe('expired');
    });

    it('leaves a recent pending attempt alone', async () => {
      await seedRun('run-fresh', { currentVersionId: 'v1', attemptStartedAt: new Date() });

      await expireStaleRuns({ ttlMs: TTL });

      expect(await statusOf('run-fresh')).toBe('pending');
    });

    it('never touches a run that already reached a final state', async () => {
      const old = new Date(Date.now() - HOUR);
      await seedRun('run-ready', { status: 'ready', requestedAt: old, attemptStartedAt: old });
      await seedRun('run-failed', { status: 'failed', requestedAt: old, attemptStartedAt: old });

      await expireStaleRuns({ ttlMs: TTL });

      expect(await statusOf('run-ready')).toBe('ready');
      expect(await statusOf('run-failed')).toBe('failed');
    });

    it('an attempt expired by the sweep can no longer be completed into ready', async () => {
      await seedRun('run-expired', {
        currentVersionId: 'v1',
        attemptStartedAt: new Date(Date.now() - HOUR),
      });
      await expireStaleRuns({ ttlMs: TTL });

      const late = await complete('run-expired', 'v1');

      expect(late.applied).toBe(false);
      expect(await statusOf('run-expired')).toBe('expired');
    });
  });
});
