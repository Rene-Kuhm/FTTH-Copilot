import { describe, expect, it } from 'vitest';
import {
  investigationResultSchema,
  type InvestigationResult,
  type InvestigationEvidenceRef,
} from '@ftth-copilot/shared';
import {
  validateInvestigationResult,
  buildSafeFallbackResult,
} from '../src/investigation-validator';

describe('validateInvestigationResult', () => {
  const windowStart = '2026-09-08T00:00:00.000Z';
  const windowEnd = '2026-09-09T00:00:00.000Z';
  const tenantId = 'tenant-acme';

  const validEvidence: InvestigationEvidenceRef[] = [
    {
      evidenceRefId: 'ref-metric-1',
      kind: 'metric',
      source: 'telemetry:rx_power',
      observedAt: '2026-09-08T12:00:00.000Z',
      summary: 'rx_power: -28.5 dBm (critical)',
      quality: 'fresh',
      qualityReason: 'within_ttl',
    },
    {
      evidenceRefId: 'ref-event-1',
      kind: 'event',
      source: 'syslog:olt-1',
      observedAt: '2026-09-08T12:05:00.000Z',
      summary: 'event: loss-of-signal (LOS) on port 1/1/2',
      quality: 'fresh',
      qualityReason: 'fresh',
    },
  ];

  const validResult: InvestigationResult = {
    schema: 'ftth.investigation-result.v1',
    resultId: 'res-test-01',
    runId: 'run-001',
    versionId: 'ver-001',
    tenantId,
    connectionId: 'conn-1',
    incidentId: 'inc-1',
    windowStart,
    windowEnd,
    windowDays: 1,
    cutoffAt: '2026-09-09T00:00:00.000Z',
    rulesetVersion: 'ruleset@1.0.0',
    modelVersion: 'test-model',
    promptVersion: 'prompt@1.0.0',
    evidenceRefs: validEvidence,
    hypotheses: [
      {
        hypothesisId: 'hyp-1',
        summary: 'Atenuación óptica severa',
        supportLevel: 'supported',
        forRefIds: ['ref-metric-1', 'ref-event-1'],
        againstRefIds: [],
      },
    ],
    contradictions: [],
    missing: [],
    suggestedChecks: [
      {
        checkId: 'chk-1',
        kind: 'observe_only',
        description: 'Verificar estado óptico en OLT',
      },
    ],
    sufficiency: 'sufficient',
    sufficiencyReason: 'Evidencia consistente',
    producedAt: '2026-09-09T00:01:00.000Z',
    producedBy: 'agent-core@0.1.0',
  };

  it('approves a fully valid investigation result without modifications', () => {
    const report = validateInvestigationResult(validResult, { expectedTenantId: tenantId });
    expect(report.isValid).toBe(true);
    expect(report.issues).toHaveLength(0);
    expect(report.sanitizedResult.hypotheses[0].forRefIds).toEqual([
      'ref-metric-1',
      'ref-event-1',
    ]);
  });

  it('detects and purges out-of-window evidence references', () => {
    const resultWithOutdatedRef: InvestigationResult = {
      ...validResult,
      evidenceRefs: [
        ...validEvidence,
        {
          evidenceRefId: 'ref-ancient-99',
          kind: 'metric',
          source: 'telemetry:rx_power',
          observedAt: '2026-08-01T00:00:00.000Z', // Way before windowStart
          summary: 'rx_power: -19.0 dBm',
          quality: 'stale',
          qualityReason: 'expired',
        },
      ],
      hypotheses: [
        {
          hypothesisId: 'hyp-1',
          summary: 'Hipótesis con ref antigua',
          supportLevel: 'supported',
          forRefIds: ['ref-metric-1', 'ref-ancient-99'],
          againstRefIds: [],
        },
      ],
    };

    const report = validateInvestigationResult(resultWithOutdatedRef, {
      expectedTenantId: tenantId,
    });
    expect(report.isValid).toBe(false);
    expect(report.issues.some((i) => i.code === 'out_of_window_evidence')).toBe(true);
    // The ancient ref must be purged from evidenceRefs and from forRefIds
    expect(
      report.sanitizedResult.evidenceRefs.some((r) => r.evidenceRefId === 'ref-ancient-99'),
    ).toBe(false);
    expect(report.sanitizedResult.hypotheses[0].forRefIds).toEqual(['ref-metric-1']);
  });

  it('detects and purges hallucinated citations from hypotheses', () => {
    const resultWithHallucination: InvestigationResult = {
      ...validResult,
      hypotheses: [
        {
          hypothesisId: 'hyp-1',
          summary: 'Hipótesis con cita alucinada',
          supportLevel: 'supported',
          forRefIds: ['ref-metric-1', 'phantom-ref-404'],
          againstRefIds: ['ghost-ref-505'],
        },
      ],
    };

    const report = validateInvestigationResult(resultWithHallucination, {
      expectedTenantId: tenantId,
    });
    expect(report.isValid).toBe(false);
    expect(report.issues.some((i) => i.code === 'hallucinated_reference')).toBe(true);
    expect(report.sanitizedResult.hypotheses[0].forRefIds).toEqual(['ref-metric-1']);
    expect(report.sanitizedResult.hypotheses[0].againstRefIds).toEqual([]);
  });

  it('detects numerical contradictions between cited evidence and hypothesis claims', () => {
    const resultWithContradiction: InvestigationResult = {
      ...validResult,
      evidenceRefs: [
        {
          evidenceRefId: 'ref-metric-good',
          kind: 'metric',
          source: 'telemetry:rx_power',
          observedAt: '2026-09-08T12:00:00.000Z',
          summary: 'rx_power: -18.2 dBm (excelente señal)',
          quality: 'fresh',
          qualityReason: 'within_ttl',
        },
      ],
      hypotheses: [
        {
          hypothesisId: 'hyp-contradiction',
          summary: 'Atenuación crítica severa rx_power: -34.5 dBm detectada',
          supportLevel: 'supported',
          forRefIds: ['ref-metric-good'],
          againstRefIds: [],
        },
      ],
    };

    const report = validateInvestigationResult(resultWithContradiction, {
      expectedTenantId: tenantId,
    });
    expect(report.isValid).toBe(false);
    expect(report.issues.some((i) => i.code === 'numerical_contradiction')).toBe(true);
    // Must add contradiction note or missing observation explaining mismatch
    expect(report.sanitizedResult.contradictions.length).toBeGreaterThanOrEqual(1);
    expect(report.sanitizedResult.sufficiency).toBe('provisional');
  });

  it('enforces tenant match and rejects tenant spoofing', () => {
    const spoofedResult: InvestigationResult = {
      ...validResult,
      tenantId: 'other-tenant-hacker',
    };

    const report = validateInvestigationResult(spoofedResult, {
      expectedTenantId: tenantId,
    });
    expect(report.isValid).toBe(false);
    expect(report.issues.some((i) => i.code === 'cross_tenant_evidence')).toBe(true);
    expect(report.sanitizedResult.tenantId).toBe(tenantId);
    expect(report.sanitizedResult.sufficiency).toBe('insufficient');
  });
});

describe('buildSafeFallbackResult', () => {
  it('constructs a valid schema-compliant fallback envelope upon critical failure', () => {
    const fallback = buildSafeFallbackResult({
      tenantId: 'tenant-acme',
      connectionId: 'conn-1',
      incidentId: 'inc-1',
      runId: 'run-001',
      versionId: 'ver-001',
      windowStart: '2026-09-08T00:00:00.000Z',
      windowEnd: '2026-09-09T00:00:00.000Z',
      reason: 'JSON parsing failure from upstream LLM',
    });

    const parsed = investigationResultSchema.parse(fallback);
    expect(parsed.schema).toBe('ftth.investigation-result.v1');
    expect(parsed.sufficiency).toBe('insufficient');
    expect(parsed.missing.some((m) => m.what.includes('JSON parsing failure'))).toBe(true);
    expect(parsed.suggestedChecks.length).toBeGreaterThanOrEqual(1);
    expect(parsed.suggestedChecks[0].kind).toBe('observe_only');
  });
});
