import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InvestigationResult } from '@ftth-copilot/shared';

const mocks = vi.hoisted(() => ({
  runFindFirst: vi.fn(),
  runCreate: vi.fn(),
  runUpdate: vi.fn(),
  versionFindFirst: vi.fn(),
  versionFindMany: vi.fn(),
  versionCreate: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('../src/client', () => ({
  prisma: {
    investigationRun: {
      findFirst: mocks.runFindFirst,
      create: mocks.runCreate,
      update: mocks.runUpdate,
    },
    investigationVersion: {
      findFirst: mocks.versionFindFirst,
      findMany: mocks.versionFindMany,
      create: mocks.versionCreate,
    },
    $transaction: mocks.transaction,
  },
}));

import {
  persistInvestigationVersion,
  getLatestInvestigationVersion,
  getInvestigationVersionById,
} from '../src/investigation-store';

describe('investigation-store (unit tests)', () => {
  const tenantId = 'tenant-acme';
  const runId = 'run-001';
  const versionId = 'ver-001';

  const validResult: InvestigationResult = {
    schema: 'ftth.investigation-result.v1',
    resultId: 'res-101',
    runId,
    versionId,
    tenantId,
    connectionId: 'conn-1',
    incidentId: 'inc-1',
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
        summary: 'rx_power: -28.5 dBm',
        quality: 'fresh',
        qualityReason: 'within_ttl',
      },
    ],
    hypotheses: [
      {
        hypothesisId: 'hyp-1',
        summary: 'Atenuación severa',
        supportLevel: 'supported',
        forRefIds: ['ref-1'],
        againstRefIds: [],
      },
    ],
    contradictions: [],
    missing: [],
    suggestedChecks: [],
    sufficiency: 'sufficient',
    sufficiencyReason: 'Evidencia completa',
    producedAt: '2026-09-09T00:00:00.000Z',
    producedBy: 'agent-core@0.1.0',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Default transaction implementation: executes callback with mocked prisma
    mocks.transaction.mockImplementation(async (cb) => {
      return cb({
        investigationRun: {
          findFirst: mocks.runFindFirst,
          create: mocks.runCreate,
          update: mocks.runUpdate,
        },
        investigationVersion: {
          findFirst: mocks.versionFindFirst,
          findMany: mocks.versionFindMany,
          create: mocks.versionCreate,
        },
      });
    });
  });

  it('rejects an invalid investigation result before database transaction', async () => {
    const invalidResult = { ...validResult, schema: 'invalid-schema' } as unknown as InvestigationResult;
    await expect(
      persistInvestigationVersion({
        tenantId,
        runId,
        investigationResult: invalidResult,
      }),
    ).rejects.toThrow();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('persists initial version with index 0 when no prior version exists', async () => {
    mocks.runFindFirst.mockResolvedValue({ id: 'db-run-1', tenantId, runId });
    mocks.versionFindFirst.mockResolvedValue(null); // No previous version
    mocks.versionCreate.mockResolvedValue({
      id: 'db-ver-1',
      tenantId,
      runId,
      versionId,
      versionIndex: 0,
      rulesetVersion: validResult.rulesetVersion,
      promptVersion: validResult.promptVersion,
      modelVersion: validResult.modelVersion,
      snapshotJson: validResult,
      snapshotAt: new Date(),
    });

    const persisted = await persistInvestigationVersion({
      tenantId,
      runId,
      investigationResult: validResult,
    });

    expect(persisted.versionIndex).toBe(0);
    expect(mocks.versionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId,
          runId,
          versionId,
          versionIndex: 0,
          snapshotJson: validResult,
        }),
      }),
    );
    expect(mocks.runUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'db-run-1' },
        data: expect.objectContaining({ status: 'ready' }),
      }),
    );
  });

  it('atomically increments versionIndex when prior versions exist', async () => {
    mocks.runFindFirst.mockResolvedValue({ id: 'db-run-1', tenantId, runId });
    mocks.versionFindFirst.mockResolvedValue({ versionIndex: 2 }); // Prior version 2
    mocks.versionCreate.mockResolvedValue({
      id: 'db-ver-3',
      tenantId,
      runId,
      versionId,
      versionIndex: 3,
      rulesetVersion: validResult.rulesetVersion,
      promptVersion: validResult.promptVersion,
      modelVersion: validResult.modelVersion,
      snapshotJson: validResult,
      snapshotAt: new Date(),
    });

    const persisted = await persistInvestigationVersion({
      tenantId,
      runId,
      investigationResult: validResult,
    });

    expect(persisted.versionIndex).toBe(3);
    expect(mocks.versionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          versionIndex: 3,
        }),
      }),
    );
  });

  it('retrieves latest version and parses snapshotJson into InvestigationResult', async () => {
    mocks.versionFindFirst.mockResolvedValue({
      id: 'db-ver-1',
      tenantId,
      runId,
      versionId,
      versionIndex: 1,
      rulesetVersion: validResult.rulesetVersion,
      promptVersion: validResult.promptVersion,
      modelVersion: validResult.modelVersion,
      snapshotJson: validResult,
      snapshotAt: new Date('2026-09-09T00:00:00.000Z'),
    });

    const latest = await getLatestInvestigationVersion({ tenantId, runId });
    expect(latest).not.toBeNull();
    expect(latest?.versionIndex).toBe(1);
    expect(latest?.snapshot.schema).toBe('ftth.investigation-result.v1');
    expect(latest?.snapshot.hypotheses).toHaveLength(1);
  });

  it('retrieves a specific immutable historical version by versionId', async () => {
    mocks.versionFindFirst.mockResolvedValue({
      id: 'db-ver-0',
      tenantId,
      runId,
      versionId: 'ver-historical-0',
      versionIndex: 0,
      rulesetVersion: validResult.rulesetVersion,
      promptVersion: validResult.promptVersion,
      modelVersion: validResult.modelVersion,
      snapshotJson: validResult,
      snapshotAt: new Date('2026-09-08T00:00:00.000Z'),
    });

    const version = await getInvestigationVersionById({
      tenantId,
      runId,
      versionId: 'ver-historical-0',
    });
    expect(version).not.toBeNull();
    expect(version?.versionId).toBe('ver-historical-0');
    expect(version?.versionIndex).toBe(0);
  });
});
