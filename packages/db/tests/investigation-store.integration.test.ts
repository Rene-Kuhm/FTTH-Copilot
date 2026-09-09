import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { InvestigationResult } from '@ftth-copilot/shared';
import { prisma } from '../src/client';
import {
  persistInvestigationVersion,
  getLatestInvestigationVersion,
  getInvestigationVersionById,
  listInvestigationVersions,
} from '../src/investigation-store';

const suite = (process.env['DATABASE_URL'] ?? '').startsWith('postgres')
  ? describe
  : describe.skip;

const TENANT_A = 'it-store-tenant-a';
const TENANT_B = 'it-store-tenant-b';
const USER_A = 'it-store-user-a';
const RUN_A = 'r_store_a';

suite('investigation-store (PostgreSQL integration)', () => {
  const resultV0: InvestigationResult = {
    schema: 'ftth.investigation-result.v1',
    resultId: 'res-store-0',
    runId: RUN_A,
    versionId: 'v_store_0',
    tenantId: TENANT_A,
    connectionId: null,
    incidentId: null,
    windowStart: '2026-09-08T00:00:00.000Z',
    windowEnd: '2026-09-09T00:00:00.000Z',
    windowDays: 1,
    cutoffAt: '2026-09-09T00:00:00.000Z',
    rulesetVersion: 'ruleset@1.0.0',
    modelVersion: 'test-model',
    promptVersion: 'prompt@1.0.0',
    evidenceRefs: [
      {
        evidenceRefId: 'ref-1',
        kind: 'metric',
        source: 'telemetry:rx_power',
        observedAt: '2026-09-08T12:00:00.000Z',
        summary: 'rx_power: -28.0 dBm',
        quality: 'fresh',
        qualityReason: 'within_ttl',
      },
    ],
    hypotheses: [
      {
        hypothesisId: 'hyp-1',
        summary: 'Atenuación crítica observada',
        supportLevel: 'supported',
        forRefIds: ['ref-1'],
        againstRefIds: [],
      },
    ],
    contradictions: [],
    missing: [],
    suggestedChecks: [],
    sufficiency: 'provisional',
    sufficiencyReason: 'Evidencia inicial',
    producedAt: '2026-09-09T00:01:00.000Z',
    producedBy: 'agent-core@0.1.0',
  };

  const resultV1: InvestigationResult = {
    ...resultV0,
    resultId: 'res-store-1',
    versionId: 'v_store_1',
    sufficiency: 'sufficient',
    sufficiencyReason: 'Evidencia confirmada en segunda corrida',
  };

  beforeAll(async () => {
    for (const tenantId of [TENANT_A, TENANT_B]) {
      await prisma.tenant.upsert({
        where: { id: tenantId },
        create: { id: tenantId, name: tenantId, slug: tenantId },
        update: {},
      });
    }
    await prisma.user.upsert({
      where: { id: USER_A },
      create: {
        id: USER_A,
        email: `${USER_A}@test.internal`,
        passwordHash: 'irrelevant',
        role: 'OPERATOR',
        tenantId: TENANT_A,
      },
      update: {},
    });

    await prisma.investigationVersion.deleteMany({
      where: { tenantId: { in: [TENANT_A, TENANT_B] } },
    });
    await prisma.investigationRun.deleteMany({
      where: { tenantId: { in: [TENANT_A, TENANT_B] } },
    });
  });

  afterAll(async () => {
    await prisma.investigationVersion.deleteMany({
      where: { tenantId: { in: [TENANT_A, TENANT_B] } },
    });
    await prisma.investigationRun.deleteMany({
      where: { tenantId: { in: [TENANT_A, TENANT_B] } },
    });
    await prisma.user.deleteMany({ where: { id: USER_A } });
    await prisma.tenant.deleteMany({
      where: { id: { in: [TENANT_A, TENANT_B] } },
    });
  });

  it('persists initial version (index 0) and creates run atomically', async () => {
    const v0 = await persistInvestigationVersion({
      tenantId: TENANT_A,
      runId: RUN_A,
      investigationResult: resultV0,
      requestedByUserId: USER_A,
    });

    expect(v0.versionIndex).toBe(0);
    expect(v0.versionId).toBe('v_store_0');
    expect(v0.snapshot.sufficiency).toBe('provisional');

    const run = await prisma.investigationRun.findFirst({
      where: { tenantId: TENANT_A, runId: RUN_A },
    });
    expect(run?.status).toBe('ready');
  });

  it('persists subsequent version (index 1) leaving version 0 immutable', async () => {
    const v1 = await persistInvestigationVersion({
      tenantId: TENANT_A,
      runId: RUN_A,
      investigationResult: resultV1,
    });

    expect(v1.versionIndex).toBe(1);
    expect(v1.versionId).toBe('v_store_1');
    expect(v1.snapshot.sufficiency).toBe('sufficient');

    // Verify version 0 was preserved unmodified
    const v0Historical = await getInvestigationVersionById({
      tenantId: TENANT_A,
      runId: RUN_A,
      versionId: 'v_store_0',
    });
    expect(v0Historical?.versionIndex).toBe(0);
    expect(v0Historical?.snapshot.sufficiency).toBe('provisional');
  });

  it('retrieves latest version (index 1)', async () => {
    const latest = await getLatestInvestigationVersion({
      tenantId: TENANT_A,
      runId: RUN_A,
    });
    expect(latest).not.toBeNull();
    expect(latest?.versionIndex).toBe(1);
    expect(latest?.versionId).toBe('v_store_1');
  });

  it('lists all versions in chronological index order', async () => {
    const versions = await listInvestigationVersions({
      tenantId: TENANT_A,
      runId: RUN_A,
    });
    expect(versions).toHaveLength(2);
    expect(versions[0].versionIndex).toBe(0);
    expect(versions[1].versionIndex).toBe(1);
  });

  it('enforces multi-tenant isolation: tenant B cannot read tenant A versions', async () => {
    const foreign = await getLatestInvestigationVersion({
      tenantId: TENANT_B,
      runId: RUN_A,
    });
    expect(foreign).toBeNull();
  });
});
