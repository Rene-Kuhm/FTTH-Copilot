import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@ftth-copilot/db';
import { awaitAttemptOutcome } from '../src/await';
import { beginInvestigationAttempt, completeInvestigation, failInvestigation } from '../src/complete';

/**
 * Espera acotada del resultado de un intento que corre en el worker.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const suite = DATABASE_URL?.startsWith('postgres') ? describe : describe.skip;

const TENANT = 'it-await';
const USER = 'it-await-user';
const RUN = 'r_await';

function wait(versionId: string, timeoutMs: number) {
  return awaitAttemptOutcome({ tenantId: TENANT, runId: RUN, versionId, timeoutMs, pollMs: 20 });
}

suite('awaitAttemptOutcome', () => {
  beforeAll(async () => {
    await prisma.tenant.upsert({ where: { slug: TENANT }, update: {}, create: { id: TENANT, name: TENANT, slug: TENANT } });
    await prisma.user.upsert({
      where: { id: USER },
      update: {},
      create: { id: USER, tenantId: TENANT, email: 'await@example.test', passwordHash: 'x', role: 'MEMBER' },
    });
  });

  beforeEach(async () => {
    await prisma.agentActionLog.deleteMany({ where: { tenantId: TENANT } });
    await prisma.investigationVersion.deleteMany({ where: { tenantId: TENANT } });
    await prisma.investigationRun.deleteMany({ where: { tenantId: TENANT } });
    await prisma.investigationRun.create({
      data: { tenantId: TENANT, runId: RUN, requestedByUserId: USER, status: 'pending' },
    });
    await beginInvestigationAttempt({ tenantId: TENANT, runId: RUN, versionId: 'v1' });
  });

  afterAll(async () => {
    await prisma.agentActionLog.deleteMany({ where: { tenantId: TENANT } });
    await prisma.investigationVersion.deleteMany({ where: { tenantId: TENANT } });
    await prisma.investigationRun.deleteMany({ where: { tenantId: TENANT } });
    await prisma.user.deleteMany({ where: { id: USER } });
    await prisma.tenant.deleteMany({ where: { id: TENANT } });
    await prisma.$disconnect();
  });

  it('times out while the attempt is still running', async () => {
    const started = Date.now();
    expect(await wait('v1', 120)).toEqual({ kind: 'timeout' });
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('returns the version as soon as the worker stores it', async () => {
    const waiting = wait('v1', 2000);
    setTimeout(() => {
      void completeInvestigation({
        tenantId: TENANT,
        runId: RUN,
        versionId: 'v1',
        incidentId: 'inc',
        userId: USER,
        startedAtMs: Date.now(),
        investigationResult: {
          schema: 'ftth.investigation-result.v1',
          resultId: 'res-v1',
          runId: RUN,
          versionId: 'v1',
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
        },
      });
    }, 60);

    const outcome = await waiting;

    expect(outcome.kind).toBe('ready');
    expect(outcome.kind === 'ready' && outcome.version.versionId).toBe('v1');
  });

  it('reports a failed attempt', async () => {
    await failInvestigation({ tenantId: TENANT, runId: RUN, versionId: 'v1', userId: USER, reason: 'x' });

    expect(await wait('v1', 500)).toEqual({ kind: 'failed' });
  });

  it('does not take the failure of another attempt as its own', async () => {
    await beginInvestigationAttempt({ tenantId: TENANT, runId: RUN, versionId: 'v2' });
    await failInvestigation({ tenantId: TENANT, runId: RUN, versionId: 'v2', userId: USER, reason: 'x' });

    expect(await wait('v1', 80)).toEqual({ kind: 'timeout' });
  });
});
