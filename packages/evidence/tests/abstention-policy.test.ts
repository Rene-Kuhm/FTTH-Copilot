import { describe, expect, it } from 'vitest';
import {
  shouldAbstain,
  buildAbstention,
  nextStepFor,
  formatIdentifierNextStep,
  formatMetricsNextStep,
  type AbstentionDecision,
  type TruthGateMode,
} from '../src/abstention-policy';
import type { Verdict } from '../src/types';

const IDENTIFIER_NEXTSTEP_FOR_GET_ONU =
  'No pude respaldar el diagnóstico: el identificador get_onu_detail no figura en el NMS. Verificá el identificador (ID, SN o filtro) y volvé a intentar.';
const METRICS_NEXTSTEP_FOR_GET_METRICS =
  'No pude respaldar el diagnóstico: las métricas get_metrics están vencidas o incompletas. Re-colectá datos frescos de los últimos 15 minutos antes de diagnosticar.';

describe('shouldAbstain — asymmetric policy table', () => {
  const okVerdict: Verdict = { toolName: 'list_onus', code: 'ok', reason: 'fresh-complete', severity: 'ok' };
  const staleVerdict: Verdict = { toolName: 'list_onus', code: 'stale', reason: 'expired-ttl', severity: 'warning' };
  const lowConfVerdict: Verdict = {
    toolName: 'list_onus',
    code: 'low_confidence',
    reason: 'missing-confidence',
    severity: 'warning',
  };
  const incompleteVerdict: Verdict = {
    toolName: 'get_onu_detail',
    code: 'incomplete',
    reason: 'no-envelope',
    severity: 'critical',
  };

  it.each([
    ['incomplete', 'strict', 'abstain'],
    ['stale', 'strict', 'warn'],
    ['low_confidence', 'strict', 'warn'],
    ['ok', 'strict', 'allow'],
  ] as const)('strict + %s → %s', (code, _mode, expected) => {
    const verdict = (
      code === 'incomplete' ? incompleteVerdict :
      code === 'stale' ? staleVerdict :
      code === 'low_confidence' ? lowConfVerdict :
      okVerdict
    );
    const decision: AbstentionDecision = shouldAbstain([verdict], 'strict');
    expect(decision).toBe(expected);
  });

  it.each([
    ['incomplete', 'observe'],
    ['stale', 'observe'],
    ['low_confidence', 'observe'],
    ['ok', 'observe'],
  ] as const)('observe + %s → always allow', (code, _mode) => {
    const verdict = (
      code === 'incomplete' ? incompleteVerdict :
      code === 'stale' ? staleVerdict :
      code === 'low_confidence' ? lowConfVerdict :
      okVerdict
    );
    const decision: AbstentionDecision = shouldAbstain([verdict], 'observe');
    expect(decision).toBe('allow');
  });

  it('strict + any incomplete in a mixed set abstains (overrides stale/ok)', () => {
    const decision = shouldAbstain([okVerdict, staleVerdict, incompleteVerdict], 'strict');
    expect(decision).toBe('abstain');
  });

  it('strict + only stale and ok warns (no incompletes)', () => {
    const decision = shouldAbstain([okVerdict, staleVerdict], 'strict');
    expect(decision).toBe('warn');
  });

  it('strict + only ok allows (all clean)', () => {
    const decision = shouldAbstain([okVerdict, okVerdict], 'strict');
    expect(decision).toBe('allow');
  });

  it('strict + empty verdict list allows (no signal to abstain)', () => {
    const decision = shouldAbstain([], 'strict');
    expect(decision).toBe('allow');
  });

  it('observe + empty verdict list allows', () => {
    const decision = shouldAbstain([], 'observe');
    expect(decision).toBe('allow');
  });

  it('mode truthy check: returns AbstentionDecision literal values', () => {
    expect(shouldAbstain([incompleteVerdict], 'strict')).toBe('abstain');
    const modes: TruthGateMode[] = ['strict', 'observe'];
    expect(modes).toContain('strict');
    expect(modes).toContain('observe');
  });
});

describe('buildAbstention — derivation rules', () => {
  it('throws when no incomplete verdict is present', () => {
    const verdicts: Verdict[] = [
      { toolName: 'list_onus', code: 'ok', reason: 'fresh-complete', severity: 'ok' },
    ];
    expect(() => buildAbstention(verdicts)).toThrow(/incomplete/);
  });

  it('mixed [incomplete/get_onu_detail, ok/list_onus] derives missing/available/toolsAffected', () => {
    const verdicts: Verdict[] = [
      {
        toolName: 'get_onu_detail',
        code: 'incomplete',
        reason: 'no-envelope',
        severity: 'critical',
      },
      {
        toolName: 'list_onus',
        code: 'ok',
        reason: 'fresh-complete',
        severity: 'ok',
      },
    ];
    const abstention = buildAbstention(verdicts);
    expect(abstention.missing).toEqual(['get_onu_detail']);
    expect(abstention.available).toEqual(['list_onus']);
    expect(abstention.toolsAffected).toEqual(['get_onu_detail']);
    expect(abstention.reason).toBe('incomplete');
    expect(abstention.severity).toBe('critical');
  });

  it('all-incompletes scenario: available === [] and missing.length === 2', () => {
    const verdicts: Verdict[] = [
      {
        toolName: 'get_onu_detail',
        code: 'incomplete',
        reason: 'partial-completeness',
        severity: 'warning',
      },
      {
        toolName: 'get_metrics',
        code: 'incomplete',
        reason: 'minimal-completeness',
        severity: 'critical',
      },
    ];
    const abstention = buildAbstention(verdicts);
    expect(abstention.available).toEqual([]);
    expect(abstention.missing).toHaveLength(2);
    expect(abstention.missing).toEqual(['get_onu_detail', 'get_metrics']);
    expect(abstention.toolsAffected).toHaveLength(2);
  });

  it('deduplicates toolsAffected when the same incomplete toolName appears twice', () => {
    const verdicts: Verdict[] = [
      {
        toolName: 'get_onu_detail',
        code: 'incomplete',
        reason: 'no-envelope',
        severity: 'critical',
      },
      {
        toolName: 'get_onu_detail',
        code: 'incomplete',
        reason: 'parse-error',
        severity: 'critical',
      },
    ];
    const abstention = buildAbstention(verdicts);
    expect(abstention.toolsAffected).toEqual(['get_onu_detail']);
    expect(abstention.missing).toEqual(['get_onu_detail']);
  });

  it('derives toolsAffected from non-ok verdicts (includes stale/low_confidence)', () => {
    const verdicts: Verdict[] = [
      {
        toolName: 'get_onu_detail',
        code: 'incomplete',
        reason: 'no-envelope',
        severity: 'critical',
      },
      {
        toolName: 'get_metrics',
        code: 'stale',
        reason: 'expired-ttl',
        severity: 'warning',
      },
      {
        toolName: 'list_onus',
        code: 'low_confidence',
        reason: 'missing-confidence',
        severity: 'warning',
      },
      {
        toolName: 'list_olts',
        code: 'ok',
        reason: 'fresh-complete',
        severity: 'ok',
      },
    ];
    const abstention = buildAbstention(verdicts);
    expect(abstention.toolsAffected).toEqual([
      'get_onu_detail',
      'get_metrics',
      'list_onus',
    ]);
    expect(abstention.available).toEqual(['list_olts']);
  });

  it('uses the first incomplete verdict severity as envelope severity', () => {
    const verdicts: Verdict[] = [
      {
        toolName: 'get_metrics',
        code: 'incomplete',
        reason: 'partial-completeness',
        severity: 'warning',
      },
      {
        toolName: 'get_onu_detail',
        code: 'incomplete',
        reason: 'no-envelope',
        severity: 'critical',
      },
    ];
    const abstention = buildAbstention(verdicts);
    expect(abstention.severity).toBe('warning');
  });

  it('attaches claim when provided and omits it when absent', () => {
    const verdicts: Verdict[] = [
      {
        toolName: 'get_onu_detail',
        code: 'incomplete',
        reason: 'no-envelope',
        severity: 'critical',
      },
    ];
    expect(buildAbstention(verdicts).claim).toBeUndefined();
    expect(buildAbstention(verdicts, 'Diagnóstico de la ONU MK-7').claim).toBe(
      'Diagnóstico de la ONU MK-7',
    );
  });

  it('emits ftth.abstention.v1 schema literal', () => {
    const verdicts: Verdict[] = [
      {
        toolName: 'get_onu_detail',
        code: 'incomplete',
        reason: 'no-envelope',
        severity: 'critical',
      },
    ];
    expect(buildAbstention(verdicts).schema).toBe('ftth.abstention.v1');
  });

  it('produces byte-identical envelopes for the same verdict set (determinism)', () => {
    const verdicts: Verdict[] = [
      {
        toolName: 'get_onu_detail',
        code: 'incomplete',
        reason: 'no-envelope',
        severity: 'critical',
      },
      {
        toolName: 'list_onus',
        code: 'ok',
        reason: 'fresh-complete',
        severity: 'ok',
      },
    ];
    expect(buildAbstention(verdicts)).toEqual(buildAbstention(verdicts));
  });
});

describe('nextStepFor — Spanish templates (voseo + deterministic + tool reference)', () => {
  it('is byte-identical across two invocations with the same input', () => {
    const a = nextStepFor('incomplete', ['get_onu_detail']);
    const b = nextStepFor('incomplete', ['get_onu_detail']);
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it('returns the identifier template when any toolName hints at an identifier lookup', () => {
    const result = nextStepFor('incomplete', ['get_onu_detail']);
    expect(result).toBe(IDENTIFIER_NEXTSTEP_FOR_GET_ONU);
    expect(result.toLowerCase()).toContain('verificá');
    expect(result).toContain('get_onu_detail');
  });

  it('returns the metrics template when any toolName hints at metrics/telemetry', () => {
    const result = nextStepFor('incomplete', ['get_metrics']);
    expect(result).toBe(METRICS_NEXTSTEP_FOR_GET_METRICS);
    expect(result.toLowerCase()).toContain('colectá');
    expect(result.toLowerCase()).toMatch(/15 minutos/i);
  });

  it('snapshot: identifier template is locked byte-for-byte', () => {
    expect(nextStepFor('incomplete', ['list_onus'])).toBe(
      'No pude respaldar el diagnóstico: el identificador list_onus no figura en el NMS. Verificá el identificador (ID, SN o filtro) y volvé a intentar.',
    );
  });

  it('snapshot: metrics template is locked byte-for-byte', () => {
    expect(nextStepFor('incomplete', ['list_telemetry'])).toBe(
      'No pude respaldar el diagnóstico: las métricas list_telemetry están vencidas o incompletas. Re-colectá datos frescos de los últimos 15 minutos antes de diagnosticar.',
    );
  });

  it('contains voseo verb forms (verificá, recolectá, volvé)', () => {
    expect(formatIdentifierNextStep(['x']).toLowerCase()).toMatch(/verificá|volvé/i);
    expect(formatMetricsNextStep(['x']).toLowerCase()).toMatch(/colectá|volvé/i);
  });

  it('does not branch on reason beyond the incomplete gate (defaults to metrics)', () => {
    expect(nextStepFor('no-envelope', ['get_metrics'])).toBe(METRICS_NEXTSTEP_FOR_GET_METRICS);
    expect(nextStepFor('parse-error', ['get_metrics'])).toBe(METRICS_NEXTSTEP_FOR_GET_METRICS);
  });
});

describe('demo == live parity (Fase B invariant honored by abstention policy)', () => {
  it('buildAbstention produces identical envelopes for verdict sets with identical fields', () => {
    const baseVerdicts = (): Verdict[] => [
      {
        toolName: 'get_onu_detail',
        code: 'incomplete',
        reason: 'no-envelope',
        severity: 'critical',
      },
      {
        toolName: 'list_onus',
        code: 'ok',
        reason: 'fresh-complete',
        severity: 'ok',
      },
    ];
    const demo = buildAbstention(baseVerdicts(), 'demo-claim');
    const live = buildAbstention(baseVerdicts(), 'demo-claim');
    expect(demo).toEqual(live);
    expect(demo.nextStep).toBe(live.nextStep);
    expect(demo.missing).toEqual(live.missing);
    expect(demo.toolsAffected).toEqual(live.toolsAffected);
  });
});

// ── Fase E — per-tenant abstainOnCodes (shouldAbstain 3rd arg) ────────────────

describe('shouldAbstain — Fase E tenantPolicy 3rd arg', () => {
  const incompleteVerdict: Verdict = {
    toolName: 'get_onu_detail',
    code: 'incomplete',
    reason: 'no-envelope',
    severity: 'critical',
  };
  const staleVerdict: Verdict = {
    toolName: 'list_onus',
    code: 'stale',
    reason: 'expired-ttl',
    severity: 'warning',
  };
  const lowConfVerdict: Verdict = {
    toolName: 'list_onus',
    code: 'low_confidence',
    reason: 'missing-confidence',
    severity: 'warning',
  };
  const okVerdict: Verdict = {
    toolName: 'list_onus',
    code: 'ok',
    reason: 'fresh-complete',
    severity: 'ok',
  };

  it('tenantPolicy=undefined → byte-identical Fase C (incomplete triggers abstain)', () => {
    expect(shouldAbstain([incompleteVerdict], 'strict', undefined)).toBe('abstain');
    expect(shouldAbstain([staleVerdict], 'strict', undefined)).toBe('warn');
    expect(shouldAbstain([okVerdict], 'strict', undefined)).toBe('allow');
  });

  it('tenantPolicy={abstainOnCodes: []} → never abstains (empty set disables the gate)', () => {
    expect(shouldAbstain([incompleteVerdict], 'strict', { abstainOnCodes: [] })).toBe('allow');
    expect(shouldAbstain([staleVerdict, incompleteVerdict], 'strict', { abstainOnCodes: [] })).toBe(
      'warn',
    );
    expect(shouldAbstain([okVerdict], 'strict', { abstainOnCodes: [] })).toBe('allow');
  });

  it('tenantPolicy={abstainOnCodes: ["stale"]} → stale triggers abstain (overrides incomplete-only)', () => {
    expect(shouldAbstain([staleVerdict], 'strict', { abstainOnCodes: ['stale'] })).toBe('abstain');
    // incomplete is no longer in the trigger set → falls through to warn (none here).
    expect(shouldAbstain([incompleteVerdict], 'strict', { abstainOnCodes: ['stale'] })).toBe(
      'allow',
    );
  });

  it('tenantPolicy={abstainOnCodes: ["incomplete","low_confidence"]} → both trigger abstain', () => {
    expect(
      shouldAbstain([lowConfVerdict], 'strict', { abstainOnCodes: ['incomplete', 'low_confidence'] }),
    ).toBe('abstain');
    expect(
      shouldAbstain([incompleteVerdict], 'strict', { abstainOnCodes: ['incomplete', 'low_confidence'] }),
    ).toBe('abstain');
    // stale is NOT in the override → falls through to warn (it is in the warn set).
    expect(
      shouldAbstain([staleVerdict], 'strict', { abstainOnCodes: ['incomplete', 'low_confidence'] }),
    ).toBe('warn');
  });

  it('observe mode ignores tenantPolicy.abstainOnCodes (Fase B invariant preserved)', () => {
    expect(
      shouldAbstain([incompleteVerdict], 'observe', { abstainOnCodes: ['incomplete'] }),
    ).toBe('allow');
    expect(
      shouldAbstain([staleVerdict], 'observe', { abstainOnCodes: ['stale'] }),
    ).toBe('allow');
    expect(shouldAbstain([incompleteVerdict], 'observe', undefined)).toBe('allow');
  });

  it('stale and low_confidence fall through to warn when the override set excludes them', () => {
    expect(shouldAbstain([staleVerdict], 'strict', { abstainOnCodes: ['incomplete'] })).toBe(
      'warn',
    );
    expect(shouldAbstain([lowConfVerdict], 'strict', { abstainOnCodes: ['incomplete'] })).toBe(
      'warn',
    );
  });
});