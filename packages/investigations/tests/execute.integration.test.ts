import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@ftth-copilot/db';
import type { InvestigationResult } from '@ftth-copilot/shared';
import { beginInvestigationAttempt } from '../src/complete';
import {
  executeInvestigationAttempt,
  isRetryableInvestigationError,
  type PipelineRunner,
} from '../src/execute';

/**
 * Ejecución de un intento contra un Postgres real, con el pipeline inyectado.
 *
 * Cubre lo que el worker decide por cada job: correr y cerrar, saltear un
 * intento que ya no es el vigente, rechazar un tenant ajeno, reintentar solo
 * errores pasajeros y fallar al agotar los intentos.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const suite = DATABASE_URL?.startsWith('postgres') ? describe : describe.skip;

const TENANT = 'it-exec';
const OTHER_TENANT = 'it-exec-other';
const USER = 'it-exec-user';
const RUN = 'r_exec';

let incidentId = '';

function resultFor(versionId: string): InvestigationResult {
  return {
    schema: 'ftth.investigation-result.v1',
    resultId: `res-${versionId}`,
    runId: RUN,
    versionId,
    tenantId: TENANT,
    connectionId: null,
    incidentId,
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

function attempt(versionId: string, tenantId = TENANT) {
  return { tenantId, incidentId, runId: RUN, versionId, userId: USER, startedAtMs: Date.now() };
}

async function statusOf(): Promise<string | undefined> {
  const row = await prisma.investigationRun.findFirst({
    where: { tenantId: TENANT, runId: RUN },
    select: { status: true },
  });
  return row?.status;
}

async function startAttempt(versionId: string): Promise<void> {
  await beginInvestigationAttempt({ tenantId: TENANT, runId: RUN, versionId });
}

const ok: PipelineRunner = async (args) => resultFor(args.versionId);

function connectionRefused(): Error {
  return Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' });
}

suite('executeInvestigationAttempt', () => {
  beforeAll(async () => {
    for (const id of [TENANT, OTHER_TENANT]) {
      await prisma.tenant.upsert({
        where: { slug: id },
        update: {},
        create: { id, name: id, slug: id },
      });
    }
    await prisma.user.upsert({
      where: { id: USER },
      update: {},
      create: { id: USER, tenantId: TENANT, email: 'exec@example.test', passwordHash: 'x', role: 'MEMBER' },
    });
  });

  beforeEach(async () => {
    for (const id of [TENANT, OTHER_TENANT]) {
      await prisma.agentActionLog.deleteMany({ where: { tenantId: id } });
      await prisma.investigationVersion.deleteMany({ where: { tenantId: id } });
      await prisma.investigationRun.deleteMany({ where: { tenantId: id } });
      await prisma.incident.deleteMany({ where: { tenantId: id } });
    }
    const incident = await prisma.incident.create({
      data: {
        tenantId: TENANT,
        deviceKind: 'ONU',
        deviceId: 'onu-1',
        title: 'LOS',
        description: 'test',
        severity: 'critical',
        status: 'resolved',
      },
    });
    incidentId = incident.id;
    await prisma.investigationRun.create({
      data: { tenantId: TENANT, runId: RUN, incidentId, requestedByUserId: USER, status: 'pending' },
    });
  });

  afterAll(async () => {
    for (const id of [TENANT, OTHER_TENANT]) {
      await prisma.agentActionLog.deleteMany({ where: { tenantId: id } });
      await prisma.investigationVersion.deleteMany({ where: { tenantId: id } });
      await prisma.investigationRun.deleteMany({ where: { tenantId: id } });
      await prisma.incident.deleteMany({ where: { tenantId: id } });
    }
    await prisma.user.deleteMany({ where: { id: USER } });
    await prisma.tenant.deleteMany({ where: { id: { in: [TENANT, OTHER_TENANT] } } });
    await prisma.$disconnect();
  });

  it('runs the pipeline once and leaves the run ready with its version', async () => {
    await startAttempt('v1');
    const pipeline = vi.fn(ok);

    const outcome = await executeInvestigationAttempt(attempt('v1'), { attemptsMade: 0, maxAttempts: 3 }, pipeline);

    expect(outcome).toMatchObject({ status: 'completed', applied: true });
    expect(pipeline).toHaveBeenCalledTimes(1);
    expect(await statusOf()).toBe('ready');
  });

  it('skips an attempt that is no longer in flight, without running the pipeline', async () => {
    await startAttempt('v1');
    await startAttempt('v2');
    const pipeline = vi.fn(ok);

    const outcome = await executeInvestigationAttempt(attempt('v1'), { attemptsMade: 0, maxAttempts: 3 }, pipeline);

    expect(outcome.status).toBe('skipped');
    expect(pipeline).not.toHaveBeenCalled();
    expect(await statusOf()).toBe('pending');
  });

  it('rejects a tenant that does not own the incident, without running the pipeline', async () => {
    await startAttempt('v1');
    const pipeline = vi.fn(ok);

    const outcome = await executeInvestigationAttempt(
      attempt('v1', OTHER_TENANT),
      { attemptsMade: 0, maxAttempts: 3 },
      pipeline,
    );

    expect(outcome.status).toBe('failed');
    expect(pipeline).not.toHaveBeenCalled();
    // The foreign tenant cannot touch the run of the owner either.
    expect(await statusOf()).toBe('pending');
  });

  it('asks for a retry on a transient error while attempts remain', async () => {
    await startAttempt('v1');

    const outcome = await executeInvestigationAttempt(attempt('v1'), { attemptsMade: 0, maxAttempts: 3 }, async () => {
      throw connectionRefused();
    });

    expect(outcome.status).toBe('retry');
    expect(await statusOf()).toBe('pending');
  });

  it('fails the run on the last attempt, so the incident can be investigated again', async () => {
    await startAttempt('v1');

    const outcome = await executeInvestigationAttempt(attempt('v1'), { attemptsMade: 2, maxAttempts: 3 }, async () => {
      throw connectionRefused();
    });

    expect(outcome.status).toBe('failed');
    expect(await statusOf()).toBe('failed');
  });

  it('fails at once on an error that a retry cannot fix', async () => {
    await startAttempt('v1');

    const outcome = await executeInvestigationAttempt(attempt('v1'), { attemptsMade: 0, maxAttempts: 3 }, async () => {
      throw new Error('result does not match the schema');
    });

    expect(outcome.status).toBe('failed');
    expect(await statusOf()).toBe('failed');
    const log = await prisma.agentActionLog.findFirst({
      where: { tenantId: TENANT, toolName: '__investigation_failed__' },
    });
    expect(log?.errorMessage).toBe('result does not match the schema');
  });
});

describe('isRetryableInvestigationError', () => {
  it('retries an unavailable store or network', () => {
    expect(isRetryableInvestigationError({ code: 'P1001' })).toBe(true);
    expect(isRetryableInvestigationError({ code: 'ECONNRESET' })).toBe(true);
    expect(isRetryableInvestigationError({ name: 'PrismaClientInitializationError' })).toBe(true);
  });

  it('retries a provider that is throttling or down', () => {
    expect(isRetryableInvestigationError({ status: 429 })).toBe(true);
    expect(isRetryableInvestigationError({ status: 503 })).toBe(true);
  });

  it('does not retry a client error or invalid data', () => {
    expect(isRetryableInvestigationError({ status: 400 })).toBe(false);
    expect(isRetryableInvestigationError({ code: 'P2003' })).toBe(false);
    expect(isRetryableInvestigationError(new Error('boom'))).toBe(false);
    expect(isRetryableInvestigationError(null)).toBe(false);
  });
});
