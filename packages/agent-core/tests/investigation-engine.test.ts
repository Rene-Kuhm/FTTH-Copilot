import { describe, expect, it } from 'vitest';
import {
  investigationResultSchema,
  type InvestigationEvidenceRef,
} from '@ftth-copilot/shared';
import { investigateIncident } from '../src/investigation-engine';
import type { LlmClient, LlmRequest, LlmResponse } from '../src/llm';

describe('investigateIncident', () => {
  const windowStart = '2026-09-08T00:00:00.000Z';
  const windowEnd = '2026-09-09T00:00:00.000Z';

  const mockRefs: InvestigationEvidenceRef[] = [
    {
      evidenceRefId: 'ref-metric-1',
      kind: 'metric',
      source: 'telemetry:rx_power',
      observedAt: '2026-09-08T10:00:00.000Z',
      summary: 'rx_power: -28.5 dBm (critical)',
      quality: 'fresh',
      qualityReason: 'within_ttl',
    },
    {
      evidenceRefId: 'ref-event-1',
      kind: 'event',
      source: 'syslog:olt-1',
      observedAt: '2026-09-08T10:05:00.000Z',
      summary: 'event: loss-of-signal (LOS) on port 1/1/2',
      quality: 'fresh',
      qualityReason: 'fresh',
    },
  ];

  it('rejects invalid window bounds (windowEnd < windowStart)', async () => {
    await expect(
      investigateIncident({
        tenantId: 'tenant-acme',
        connectionId: 'conn-1',
        incidentId: 'inc-101',
        runId: 'run-001',
        versionId: 'ver-001',
        windowStart: '2026-09-10T00:00:00.000Z',
        windowEnd: '2026-09-08T00:00:00.000Z',
        evidenceRefs: mockRefs,
      }),
    ).rejects.toThrow(/windowEnd/);
  });

  it('rejects windowDays exceeding 30 days', async () => {
    await expect(
      investigateIncident({
        tenantId: 'tenant-acme',
        connectionId: 'conn-1',
        incidentId: 'inc-101',
        runId: 'run-001',
        versionId: 'ver-001',
        windowStart: '2026-08-01T00:00:00.000Z',
        windowEnd: '2026-09-09T00:00:00.000Z', // > 30 days
        evidenceRefs: mockRefs,
      }),
    ).rejects.toThrow(/window/);
  });

  it('runs deterministically without LLM client and satisfies the schema', async () => {
    const result = await investigateIncident({
      tenantId: 'tenant-acme',
      connectionId: 'conn-1',
      incidentId: 'inc-101',
      runId: 'run-001',
      versionId: 'ver-001',
      windowStart,
      windowEnd,
      evidenceRefs: mockRefs,
    });

    // Must validate completely against ftth.investigation-result.v1
    const parsed = investigationResultSchema.parse(result);
    expect(parsed.schema).toBe('ftth.investigation-result.v1');
    expect(parsed.tenantId).toBe('tenant-acme');
    expect(parsed.evidenceRefs).toHaveLength(2);
    expect(parsed.hypotheses.length).toBeGreaterThanOrEqual(1);
    expect(parsed.producedBy).toMatch(/^agent-core@\S+$/);
    expect(['sufficient', 'provisional', 'insufficient']).toContain(parsed.sufficiency);
  });

  it('integrates LLM interpretations and validates hypothesis citations', async () => {
    const mockLlm: LlmClient = {
      provider: 'mock-llm',
      createMessage: async (_req: LlmRequest): Promise<LlmResponse> => ({
        text: JSON.stringify({
          hypotheses: [
            {
              hypothesisId: 'hyp-attenuation',
              summary: 'Degradación severa de fibra óptica por atenuación crítica',
              supportLevel: 'supported',
              forRefIds: ['ref-metric-1', 'ref-event-1'],
              againstRefIds: [],
            },
          ],
          contradictions: [],
          missing: [
            {
              what: 'Medición OTDR reflectométrica para ubicar el corte o curvatura',
              whyItMatters: 'Permite confirmar la distancia exacta del daño físico',
            },
          ],
          suggestedChecks: [
            {
              checkId: 'chk-1',
              kind: 'observe_only',
              description: 'Inspeccionar potencia óptica actual en puerto OLT',
            },
          ],
          sufficiency: 'sufficient',
          sufficiencyReason: 'Evidencia consistente entre telemetría óptica crítica y alarma LOS',
        }),
        toolCalls: [],
      }),
    };

    const result = await investigateIncident({
      tenantId: 'tenant-acme',
      connectionId: 'conn-1',
      incidentId: 'inc-101',
      runId: 'run-001',
      versionId: 'ver-001',
      windowStart,
      windowEnd,
      evidenceRefs: mockRefs,
      llmClient: mockLlm,
    });

    const parsed = investigationResultSchema.parse(result);
    expect(parsed.hypotheses).toHaveLength(1);
    expect(parsed.hypotheses[0].hypothesisId).toBe('hyp-attenuation');
    expect(parsed.hypotheses[0].forRefIds).toEqual(['ref-metric-1', 'ref-event-1']);
    expect(parsed.suggestedChecks[0].kind).toBe('observe_only');
    expect(parsed.sufficiency).toBe('sufficient');
  });

  it('prunes hallucinated evidence references from LLM hypotheses', async () => {
    const mockLlmWithHallucination: LlmClient = {
      provider: 'mock-llm',
      createMessage: async (_req: LlmRequest): Promise<LlmResponse> => ({
        text: JSON.stringify({
          hypotheses: [
            {
              hypothesisId: 'hyp-1',
              summary: 'Falla con citas inventadas',
              supportLevel: 'supported',
              forRefIds: ['ref-metric-1', 'hallucinated-ref-999'],
              againstRefIds: ['phantom-ref-888'],
            },
          ],
          contradictions: [
            {
              evidenceRefId: 'ghost-contra-777',
              note: 'Contradicción inventada',
            },
          ],
          missing: [],
          suggestedChecks: [],
          sufficiency: 'provisional',
          sufficiencyReason: 'Faltan datos',
        }),
        toolCalls: [],
      }),
    };

    const result = await investigateIncident({
      tenantId: 'tenant-acme',
      connectionId: 'conn-1',
      incidentId: 'inc-101',
      runId: 'run-001',
      versionId: 'ver-001',
      windowStart,
      windowEnd,
      evidenceRefs: mockRefs,
      llmClient: mockLlmWithHallucination,
    });

    const parsed = investigationResultSchema.parse(result);
    // Hallucinated refs must be pruned
    expect(parsed.hypotheses[0].forRefIds).toEqual(['ref-metric-1']);
    expect(parsed.hypotheses[0].againstRefIds).toEqual([]);
    // Invalid contradiction must be dropped
    expect(parsed.contradictions).toHaveLength(0);
  });

  it('sanitizes forbidden check kinds (e.g. reboot/provision) to safe read-only kinds', async () => {
    const mockLlmWithForbiddenChecks: LlmClient = {
      provider: 'mock-llm',
      createMessage: async (_req: LlmRequest): Promise<LlmResponse> => ({
        text: JSON.stringify({
          hypotheses: [
            {
              hypothesisId: 'hyp-1',
              summary: 'Falla de conexión',
              supportLevel: 'supported',
              forRefIds: ['ref-metric-1'],
              againstRefIds: [],
            },
          ],
          contradictions: [],
          missing: [],
          suggestedChecks: [
            {
              checkId: 'chk-bad',
              kind: 'reboot', // FORBIDDEN by Roadmap Regla 8
              description: 'Reiniciar la ONU',
            },
          ],
          sufficiency: 'provisional',
          sufficiencyReason: 'Provisional',
        }),
        toolCalls: [],
      }),
    };

    const result = await investigateIncident({
      tenantId: 'tenant-acme',
      connectionId: 'conn-1',
      incidentId: 'inc-101',
      runId: 'run-001',
      versionId: 'ver-001',
      windowStart,
      windowEnd,
      evidenceRefs: mockRefs,
      llmClient: mockLlmWithForbiddenChecks,
    });

    const parsed = investigationResultSchema.parse(result);
    // Forbidden kind must be coerced to 'observe_only'
    expect(parsed.suggestedChecks[0].kind).toBe('observe_only');
    expect(parsed.suggestedChecks[0].description).toContain('[Read-Only]');
  });

  it('falls back to deterministic provisional envelope if LLM throws error or returns malformed text', async () => {
    const failingLlm: LlmClient = {
      provider: 'failing-llm',
      createMessage: async (): Promise<LlmResponse> => {
        throw new Error('500 Internal Server Error from upstream LLM');
      },
    };

    const result = await investigateIncident({
      tenantId: 'tenant-acme',
      connectionId: 'conn-1',
      incidentId: 'inc-101',
      runId: 'run-001',
      versionId: 'ver-001',
      windowStart,
      windowEnd,
      evidenceRefs: mockRefs,
      llmClient: failingLlm,
    });

    const parsed = investigationResultSchema.parse(result);
    expect(parsed.sufficiency).toBe('provisional');
    expect(parsed.sufficiencyReason).toMatch(/fallback determinista/i);
    expect(parsed.missing.some((m) => m.what.includes('LLM'))).toBe(true);
  });
});
