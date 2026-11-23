import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InvestigationEvidenceRef, InvestigationResult } from '@ftth-copilot/shared';

const mocks = vi.hoisted(() => ({
  metricFindMany: vi.fn(),
  eventFindMany: vi.fn(),
  edgeFindMany: vi.fn(),
  confirmedFindMany: vi.fn(),
  feedbackFindMany: vi.fn(),
  collectInvestigationEvidence: vi.fn(),
  investigateIncident: vi.fn(),
  validateInvestigationResult: vi.fn(),
  buildSafeFallbackResult: vi.fn(),
}));

vi.mock('@ftth-copilot/db', () => ({
  prisma: {
    metricSample: { findMany: mocks.metricFindMany },
    deviceEvent: { findMany: mocks.eventFindMany },
    topologyEdge: { findMany: mocks.edgeFindMany },
    confirmedIncident: { findMany: mocks.confirmedFindMany },
    investigationFeedback: { findMany: mocks.feedbackFindMany },
  },
}));

vi.mock('@ftth-copilot/evidence', () => ({
  collectInvestigationEvidence: mocks.collectInvestigationEvidence,
}));

vi.mock('@ftth-copilot/agent-core', () => ({
  investigateIncident: mocks.investigateIncident,
  validateInvestigationResult: mocks.validateInvestigationResult,
  buildSafeFallbackResult: mocks.buildSafeFallbackResult,
}));

import { runInvestigationPipeline, type RunInvestigationPipelineArgs } from '../src/pipeline';

const FIXED_NOW = new Date('2026-10-15T12:00:00.000Z');
const TENANT_ALPHA = 'tenant-alpha';
const TENANT_BETA = 'tenant-beta';

function makeArgs(overrides: Partial<RunInvestigationPipelineArgs> = {}): RunInvestigationPipelineArgs {
  return {
    tenantId: TENANT_ALPHA,
    incidentId: 'inc-001',
    runId: 'run-001',
    versionId: 'ver-001',
    deviceId: 'onu-101',
    deviceKind: 'ONU',
    connectionId: 'conn-01',
    ...overrides,
  };
}

function makeInvestigationResult(overrides: Partial<InvestigationResult> = {}): InvestigationResult {
  return {
    schema: 'ftth.investigation-result.v1',
    resultId: 'res-001',
    runId: 'run-001',
    versionId: 'ver-001',
    tenantId: TENANT_ALPHA,
    connectionId: 'conn-01',
    incidentId: 'inc-001',
    windowStart: '2026-10-08T12:00:00.000Z',
    windowEnd: '2026-10-15T12:00:00.000Z',
    windowDays: 7,
    cutoffAt: '2026-10-15T12:00:00.000Z',
    rulesetVersion: 'ruleset@1.0.0',
    modelVersion: 'test-model',
    promptVersion: 'prompt@1.0.0',
    evidenceRefs: [],
    hypotheses: [],
    contradictions: [],
    missing: [],
    suggestedChecks: [],
    sufficiency: 'provisional',
    sufficiencyReason: 'Evidencia sintética de prueba',
    producedAt: '2026-10-15T12:00:05.000Z',
    producedBy: 'agent-core@0.1.0',
    ...overrides,
  };
}

describe('runInvestigationPipeline', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    vi.clearAllMocks();

    mocks.metricFindMany.mockResolvedValue([]);
    mocks.eventFindMany.mockResolvedValue([]);
    mocks.edgeFindMany.mockResolvedValue([]);
    mocks.confirmedFindMany.mockResolvedValue([]);
    mocks.feedbackFindMany.mockResolvedValue([]);
    mocks.collectInvestigationEvidence.mockReturnValue([]);

    const rawResult = makeInvestigationResult();
    mocks.investigateIncident.mockResolvedValue(rawResult);
    mocks.validateInvestigationResult.mockReturnValue({
      isValid: true,
      issues: [],
      sanitizedResult: rawResult,
    });
    mocks.buildSafeFallbackResult.mockReturnValue(
      makeInvestigationResult({ resultId: 'res-fallback', sufficiency: 'insufficient' }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('aisla por tenantId todas las consultas Prisma y la validación final sin filtrar datos de otro tenant', async () => {
    await runInvestigationPipeline(makeArgs({ tenantId: TENANT_ALPHA }));

    const queryMocks = [
      mocks.metricFindMany,
      mocks.eventFindMany,
      mocks.edgeFindMany,
      mocks.confirmedFindMany,
      mocks.feedbackFindMany,
    ];

    for (const queryMock of queryMocks) {
      expect(queryMock).toHaveBeenCalledTimes(1);
      const callArg = queryMock.mock.calls[0]?.[0] as { where?: { tenantId?: string } };
      expect(callArg.where?.tenantId).toBe(TENANT_ALPHA);
      expect(callArg.where?.tenantId).not.toBe(TENANT_BETA);
    }

    expect(mocks.collectInvestigationEvidence).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_ALPHA }),
    );
    expect(mocks.investigateIncident).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_ALPHA }),
    );
    expect(mocks.validateInvestigationResult).toHaveBeenCalledWith(
      expect.anything(),
      { expectedTenantId: TENANT_ALPHA },
    );
  });

  it('aplica los límites take, filtros y ordenamiento esperados en las cinco consultas Prisma', async () => {
    await runInvestigationPipeline(makeArgs({ windowDays: 7 }));

    const expectedEnd = new Date('2026-10-15T12:00:00.000Z');
    const expectedStart = new Date('2026-10-08T12:00:00.000Z');

    expect(mocks.metricFindMany).toHaveBeenCalledWith({
      where: {
        tenantId: TENANT_ALPHA,
        deviceId: 'onu-101',
        sampledAt: { gte: expectedStart, lte: expectedEnd },
      },
      orderBy: { sampledAt: 'desc' },
      take: 60,
    });

    expect(mocks.eventFindMany).toHaveBeenCalledWith({
      where: {
        tenantId: TENANT_ALPHA,
        occurredAt: { gte: expectedStart, lte: expectedEnd },
      },
      orderBy: { occurredAt: 'desc' },
      take: 40,
    });

    expect(mocks.edgeFindMany).toHaveBeenCalledWith({
      where: {
        tenantId: TENANT_ALPHA,
        validTo: null,
      },
      take: 20,
    });

    expect(mocks.confirmedFindMany).toHaveBeenCalledWith({
      where: {
        tenantId: TENANT_ALPHA,
        deviceId: 'onu-101',
      },
      orderBy: { observedAt: 'desc' },
      take: 10,
    });

    expect(mocks.feedbackFindMany).toHaveBeenCalledWith({
      where: {
        tenantId: TENANT_ALPHA,
      },
      orderBy: { submittedAt: 'desc' },
      take: 10,
    });
  });

  it('acota windowDays al rango [1, 30]', async () => {
    await runInvestigationPipeline(makeArgs({ windowDays: 0 }));
    expect(mocks.collectInvestigationEvidence).toHaveBeenLastCalledWith(
      expect.objectContaining({
        windowStart: '2026-10-14T12:00:00.000Z',
        windowEnd: '2026-10-15T12:00:00.000Z',
      }),
    );

    await runInvestigationPipeline(makeArgs({ windowDays: 90 }));
    expect(mocks.collectInvestigationEvidence).toHaveBeenLastCalledWith(
      expect.objectContaining({
        windowStart: '2026-09-15T12:00:00.000Z',
        windowEnd: '2026-10-15T12:00:00.000Z',
      }),
    );
  });

  it('mapea las cinco fuentes de evidencia y entrega evidenceRefs al motor cognitivo', async () => {
    const sampledAt = new Date('2026-10-15T11:30:00.000Z');
    const occurredAt = new Date('2026-10-15T11:45:00.000Z');
    const resolvedAt = new Date('2026-10-10T09:00:00.000Z');
    const submittedAt = new Date('2026-10-11T14:00:00.000Z');

    mocks.metricFindMany.mockResolvedValue([
      {
        id: 'm-1',
        tenantId: TENANT_ALPHA,
        deviceId: 'onu-101',
        kind: 'RX_POWER',
        value: -28.4,
        sampledAt,
      },
      {
        id: 'm-null',
        tenantId: TENANT_ALPHA,
        deviceId: 'onu-101',
        kind: 'STATUS',
        value: null,
        sampledAt,
      },
    ]);

    mocks.eventFindMany.mockResolvedValue([
      {
        id: 'e-1',
        tenantId: TENANT_ALPHA,
        category: 'los',
        message: 'LOS detected on PON 0/1/2',
        occurredAt,
        sourceIp: '198.51.100.10',
      },
      {
        id: 'e-2',
        tenantId: TENANT_ALPHA,
        category: 'dying_gasp',
        message: 'Power loss on ONU',
        occurredAt,
        sourceIp: null,
      },
    ]);

    mocks.edgeFindMany.mockResolvedValue([
      {
        tenantId: TENANT_ALPHA,
        parentKind: 'SPLITTER',
        parentId: 'spl-1',
        childKind: 'ONU',
        childId: 'onu-101',
      },
      {
        tenantId: TENANT_ALPHA,
        parentKind: 'OLT',
        parentId: 'olt-1',
        childKind: 'SPLITTER',
        childId: 'spl-1',
      },
    ]);

    mocks.confirmedFindMany.mockResolvedValue([
      {
        id: 'ci-1',
        tenantId: TENANT_ALPHA,
        deviceId: 'onu-101',
        summary: 'Atenuación en pigtail',
        rootCause: 'Conector sucio en CTO',
        fix: 'Limpieza de conector SC/APC',
        resolvedAt,
      },
    ]);

    mocks.feedbackFindMany.mockResolvedValue([
      {
        feedbackId: 'fb-1',
        tenantId: TENANT_ALPHA,
        runId: 'run-prev',
        versionId: 'ver-prev',
        label: 'confirmed',
        observations: 'Confirmado en campo',
        realCause: 'Conector dañado',
        submittedAt,
      },
      {
        feedbackId: 'fb-ignored',
        tenantId: TENANT_ALPHA,
        runId: 'run-prev-2',
        versionId: 'ver-prev-2',
        label: 'maintenance',
        observations: 'Debe filtrarse',
        realCause: null,
        submittedAt,
      },
    ]);

    const evidenceRefs: InvestigationEvidenceRef[] = [
      {
        evidenceRefId: 'ref-m-1',
        kind: 'metric',
        source: 'telemetry:rx_power',
        observedAt: sampledAt.toISOString(),
        summary: 'rx_power=-28.4',
        quality: 'fresh',
        qualityReason: 'within_ttl',
      },
    ];
    mocks.collectInvestigationEvidence.mockReturnValue(evidenceRefs);

    await runInvestigationPipeline(makeArgs());

    expect(mocks.collectInvestigationEvidence).toHaveBeenCalledWith({
      tenantId: TENANT_ALPHA,
      deviceId: 'onu-101',
      connectionId: 'conn-01',
      incidentId: 'inc-001',
      windowStart: '2026-10-08T12:00:00.000Z',
      windowEnd: '2026-10-15T12:00:00.000Z',
      metrics: [
        {
          sampleId: 'm-1',
          tenantId: TENANT_ALPHA,
          deviceId: 'onu-101',
          metricKind: 'RX_POWER',
          value: -28.4,
          recordedAt: sampledAt,
          source: 'telemetry:rx_power',
        },
      ],
      events: [
        {
          eventId: 'e-1',
          tenantId: TENANT_ALPHA,
          deviceId: 'onu-101',
          category: 'los',
          message: 'LOS detected on PON 0/1/2',
          observedAt: occurredAt,
          source: 'syslog:198.51.100.10',
        },
        {
          eventId: 'e-2',
          tenantId: TENANT_ALPHA,
          deviceId: 'onu-101',
          category: 'dying_gasp',
          message: 'Power loss on ONU',
          observedAt: occurredAt,
          source: 'syslog:device',
        },
      ],
      topologyHops: [
        {
          tenantId: TENANT_ALPHA,
          sourceKind: 'SPLITTER',
          sourceId: 'spl-1',
          targetKind: 'ONU',
          targetId: 'onu-101',
          depth: 1,
        },
        {
          tenantId: TENANT_ALPHA,
          sourceKind: 'OLT',
          sourceId: 'olt-1',
          targetKind: 'SPLITTER',
          targetId: 'spl-1',
          depth: 2,
        },
      ],
      confirmedIncidents: [
        {
          incidentId: 'ci-1',
          tenantId: TENANT_ALPHA,
          deviceId: 'onu-101',
          summary: 'Atenuación en pigtail',
          rootCause: 'Conector sucio en CTO',
          fix: 'Limpieza de conector SC/APC',
          resolvedAt,
        },
      ],
      feedbacks: [
        {
          feedbackId: 'fb-1',
          tenantId: TENANT_ALPHA,
          runId: 'run-prev',
          versionId: 'ver-prev',
          label: 'confirmed',
          observations: 'Confirmado en campo',
          realCause: 'Conector dañado',
          submittedAt,
        },
      ],
    });

    expect(mocks.investigateIncident).toHaveBeenCalledWith({
      tenantId: TENANT_ALPHA,
      connectionId: 'conn-01',
      incidentId: 'inc-001',
      runId: 'run-001',
      versionId: 'ver-001',
      windowStart: '2026-10-08T12:00:00.000Z',
      windowEnd: '2026-10-15T12:00:00.000Z',
      evidenceRefs,
    });
  });

  it('valida el resultado del motor y devuelve el sanitizedResult emitido por el validador', async () => {
    const rawResult = makeInvestigationResult({ resultId: 'res-raw' });
    const sanitizedResult = makeInvestigationResult({
      resultId: 'res-sanitized',
      sufficiency: 'insufficient',
      sufficiencyReason: 'Saneado por validador',
    });

    mocks.investigateIncident.mockResolvedValue(rawResult);
    mocks.validateInvestigationResult.mockReturnValue({
      isValid: false,
      issues: [{ code: 'hallucinated_reference', message: 'Removed ref' }],
      sanitizedResult,
    });

    const output = await runInvestigationPipeline(makeArgs());

    expect(mocks.validateInvestigationResult).toHaveBeenCalledWith(rawResult, {
      expectedTenantId: TENANT_ALPHA,
    });
    expect(output).toBe(sanitizedResult);
  });

  it('devuelve el fallback seguro cuando investigateIncident lanza un Error', async () => {
    const fallback = makeInvestigationResult({
      resultId: 'res-safe-fallback',
      sufficiency: 'insufficient',
      sufficiencyReason: 'Fallback por error',
    });
    mocks.investigateIncident.mockRejectedValue(new Error('LLM gateway timeout'));
    mocks.buildSafeFallbackResult.mockReturnValue(fallback);

    const output = await runInvestigationPipeline(makeArgs());

    expect(mocks.buildSafeFallbackResult).toHaveBeenCalledWith({
      tenantId: TENANT_ALPHA,
      connectionId: 'conn-01',
      incidentId: 'inc-001',
      runId: 'run-001',
      versionId: 'ver-001',
      windowStart: '2026-10-08T12:00:00.000Z',
      windowEnd: '2026-10-15T12:00:00.000Z',
      reason: 'LLM gateway timeout',
    });
    expect(mocks.validateInvestigationResult).not.toHaveBeenCalled();
    expect(output).toBe(fallback);
  });

  it('usa el mensaje por defecto en buildSafeFallbackResult cuando el motor rechaza con un valor no-Error', async () => {
    mocks.investigateIncident.mockRejectedValue('unexpected-string-failure');

    await runInvestigationPipeline(makeArgs());

    expect(mocks.buildSafeFallbackResult).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'Error inesperado en motor de investigación cognitiva',
      }),
    );
  });

  it('propaga el rechazo si falla una de las consultas Prisma sin invocar evidencia ni motor cognitivo', async () => {
    mocks.edgeFindMany.mockRejectedValue(new Error('DB connection lost'));

    await expect(runInvestigationPipeline(makeArgs())).rejects.toThrow('DB connection lost');

    expect(mocks.collectInvestigationEvidence).not.toHaveBeenCalled();
    expect(mocks.investigateIncident).not.toHaveBeenCalled();
    expect(mocks.buildSafeFallbackResult).not.toHaveBeenCalled();
    expect(mocks.validateInvestigationResult).not.toHaveBeenCalled();
  });
});
