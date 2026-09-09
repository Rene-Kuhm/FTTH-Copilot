import { describe, expect, it } from 'vitest';
import {
  investigationResultSchema,
  INVESTIGATION_RESULT_SCHEMA,
  MAX_INVESTIGATION_EVIDENCE_REFS,
  MAX_INVESTIGATION_HYPOTHESES,
  MAX_INVESTIGATION_CONTRADICTIONS,
  MAX_INVESTIGATION_MISSING,
  MAX_INVESTIGATION_CHECKS,
  MAX_INVESTIGATION_WINDOW_DAYS,
  INVESTIGATION_FREE_TEXT_BYTES,
  hypothesisSupportLevels,
  investigationCheckKinds,
  investigationSufficiencyStates,
} from '../src/contracts';

function baseResult(overrides: Partial<ReturnType<typeof make>> = {}): ReturnType<typeof make> {
  return make(overrides);
}

function make(o: Partial<ReturnType<typeof make>> = {}) {
  const start = '2026-09-01T00:00:00.000Z';
  const end = '2026-09-08T00:00:00.000Z';
  const result = {
    schema: INVESTIGATION_RESULT_SCHEMA,
    resultId: 'r_abc123',
    runId: 'r_run_1',
    versionId: 'v_1',
    tenantId: 't_1',
    connectionId: 'conn_1',
    incidentId: 'inc_1',
    windowStart: start,
    windowEnd: end,
    windowDays: 7,
    cutoffAt: end,
    rulesetVersion: 'ruleset-1.0.0',
    modelVersion: 'claude-x-1',
    promptVersion: 'prompt-investigation-1',
    evidenceRefs: [
      {
        evidenceRefId: 'ev_1',
        kind: 'metric' as const,
        source: 'smartolt.poll',
        observedAt: end,
        summary: 'RX power -22 dBm',
        quality: 'fresh' as const,
        qualityReason: 'fresh',
      },
    ],
    hypotheses: [
      {
        hypothesisId: 'h_1',
        summary: 'Conector sucio en la ONU',
        supportLevel: 'supported' as const,
        forRefIds: ['ev_1'],
        againstRefIds: [],
      },
    ],
    contradictions: [],
    missing: [
      { what: 'Historial reciente de FEC', whyItMatters: 'FEC alto correlaciona con conector sucio' },
    ],
    suggestedChecks: [
      {
        checkId: 'c_1',
        kind: 'metric_history' as const,
        description: 'Inspeccionar histórico de RX power',
        expectedToResolve: 'Confirma caída sostenida',
      },
    ],
    sufficiency: 'provisional' as const,
    sufficiencyReason: 'Falta historial de FEC',
    producedAt: '2026-09-08T00:01:00.000Z',
    producedBy: 'agent-core@0.1.0',
    ...o,
  };
  return result;
}

describe('investigationResultSchema — happy path', () => {
  it('accepts a minimal valid envelope', () => {
    const r = baseResult();
    const parsed = investigationResultSchema.parse(r);
    expect(parsed.schema).toBe('ftth.investigation-result.v1');
    expect(parsed.sufficiency).toBe('provisional');
  });

  it('accepts null connectionId / incidentId', () => {
    const r = baseResult({ connectionId: null, incidentId: null });
    expect(() => investigationResultSchema.parse(r)).not.toThrow();
  });
});

describe('investigationResultSchema — schema discipline', () => {
  it('rejects unknown extra fields (strict)', () => {
    const r = { ...baseResult(), inventedField: true } as unknown as ReturnType<typeof make>;
    expect(() => investigationResultSchema.parse(r)).toThrow();
  });

  it('rejects a wrong schema literal', () => {
    const r = { ...baseResult(), schema: 'ftth.investigation-result.v2' };
    expect(() => investigationResultSchema.parse(r)).toThrow();
  });
});

describe('investigationResultSchema — bounded arrays', () => {
  it('rejects evidenceRefs > MAX', () => {
    const oversize = Array.from({ length: MAX_INVESTIGATION_EVIDENCE_REFS + 1 }, (_, i) => ({
      evidenceRefId: `ev_${i}`,
      kind: 'metric' as const,
      source: 'x',
      observedAt: '2026-09-08T00:00:00.000Z',
      summary: 'x',
      quality: 'fresh' as const,
      qualityReason: 'fresh',
    }));
    const r = baseResult({ evidenceRefs: oversize });
    expect(() => investigationResultSchema.parse(r)).toThrow();
  });

  it('rejects hypotheses > MAX', () => {
    const oversize = Array.from({ length: MAX_INVESTIGATION_HYPOTHESES + 1 }, (_, i) => ({
      hypothesisId: `h_${i}`,
      summary: 'x',
      supportLevel: 'unverified' as const,
      forRefIds: [],
      againstRefIds: [],
    }));
    const r = baseResult({ hypotheses: oversize });
    expect(() => investigationResultSchema.parse(r)).toThrow();
  });

  it('rejects contradictions > MAX', () => {
    const oversize = Array.from({ length: MAX_INVESTIGATION_CONTRADICTIONS + 1 }, (_, i) => ({
      evidenceRefId: `ev_${i}`,
      note: 'x',
    }));
    const r = baseResult({ contradictions: oversize });
    expect(() => investigationResultSchema.parse(r)).toThrow();
  });

  it('rejects missing > MAX', () => {
    const oversize = Array.from({ length: MAX_INVESTIGATION_MISSING + 1 }, (_, i) => ({
      what: 'x',
    }));
    const r = baseResult({ missing: oversize });
    expect(() => investigationResultSchema.parse(r)).toThrow();
  });

  it('rejects suggestedChecks > MAX', () => {
    const oversize = Array.from({ length: MAX_INVESTIGATION_CHECKS + 1 }, (_, i) => ({
      checkId: `c_${i}`,
      kind: 'observe_only' as const,
      description: 'x',
    }));
    const r = baseResult({ suggestedChecks: oversize });
    expect(() => investigationResultSchema.parse(r)).toThrow();
  });
});

describe('investigationResultSchema — free text byte cap', () => {
  it('rejects a hypothesis summary above INVESTIGATION_FREE_TEXT_BYTES', () => {
    const big = 'a'.repeat(INVESTIGATION_FREE_TEXT_BYTES + 1);
    const r = baseResult({
      hypotheses: [{ hypothesisId: 'h_1', summary: big, supportLevel: 'unverified', forRefIds: [], againstRefIds: [] }],
    });
    expect(() => investigationResultSchema.parse(r)).toThrow();
  });
});

describe('investigationResultSchema — window invariants', () => {
  it('rejects windowEnd < windowStart', () => {
    const r = baseResult({
      windowStart: '2026-09-08T00:00:00.000Z',
      windowEnd: '2026-09-01T00:00:00.000Z',
    });
    expect(() => investigationResultSchema.parse(r)).toThrow(/windowEnd/);
  });

  it('rejects cutoffAt > producedAt', () => {
    const r = baseResult({
      cutoffAt: '2026-09-09T00:00:00.000Z',
      producedAt: '2026-09-08T00:00:00.000Z',
    });
    expect(() => investigationResultSchema.parse(r)).toThrow(/cutoffAt/);
  });

  it('rejects windowDays > MAX_INVESTIGATION_WINDOW_DAYS', () => {
    const r = baseResult({ windowDays: MAX_INVESTIGATION_WINDOW_DAYS + 1 });
    expect(() => investigationResultSchema.parse(r)).toThrow();
  });
});

describe('investigationResultSchema — closed enums', () => {
  it('rejects an unknown hypothesis support level', () => {
    const r = baseResult({
      hypotheses: [
        { hypothesisId: 'h_1', summary: 'x', supportLevel: 'probably' as 'supported', forRefIds: [], againstRefIds: [] },
      ],
    });
    expect(() => investigationResultSchema.parse(r)).toThrow();
  });

  it('rejects an unknown check kind', () => {
    const r = baseResult({
      suggestedChecks: [
        { checkId: 'c_1', kind: 'reboot' as 'observe_only', description: 'x' },
      ],
    });
    expect(() => investigationResultSchema.parse(r)).toThrow();
  });

  it('rejects an unknown sufficiency state', () => {
    const r = baseResult({ sufficiency: 'almost' as 'provisional' });
    expect(() => investigationResultSchema.parse(r)).toThrow();
  });

  it('lists the documented closed enums', () => {
    expect(hypothesisSupportLevels).toEqual(['supported', 'contradicted', 'mixed', 'unverified']);
    expect(investigationCheckKinds).toEqual([
      'observe_only',
      'topology_lookup',
      'recent_events',
      'metric_history',
    ]);
    expect(investigationSufficiencyStates).toEqual(['sufficient', 'provisional', 'insufficient']);
  });
});
