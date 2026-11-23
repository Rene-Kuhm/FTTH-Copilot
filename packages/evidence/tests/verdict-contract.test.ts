import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  EVIDENCE_PROVENANCE_SCHEMA,
  VerdictCodeSchema,
  VerdictSeveritySchema,
  type AgentResult,
  type Verdict as SharedVerdict,
  type VerdictCode as SharedVerdictCode,
  type VerdictSeverity as SharedVerdictSeverity,
} from '@ftth-copilot/shared';
import * as Evidence from '../src/index';
import type * as EvidenceTypes from '../src/types';

describe('Verdict canonical contract sync (shared -> evidence)', () => {
  it('re-exports Verdict, VerdictCode, and VerdictSeverity identically to @ftth-copilot/shared', () => {
    expectTypeOf<Evidence.Verdict>().toEqualTypeOf<SharedVerdict>();
    expectTypeOf<Evidence.VerdictCode>().toEqualTypeOf<SharedVerdictCode>();
    expectTypeOf<Evidence.VerdictSeverity>().toEqualTypeOf<SharedVerdictSeverity>();

    expectTypeOf<EvidenceTypes.Verdict>().toEqualTypeOf<SharedVerdict>();
    expectTypeOf<EvidenceTypes.VerdictCode>().toEqualTypeOf<SharedVerdictCode>();
    expectTypeOf<EvidenceTypes.VerdictSeverity>().toEqualTypeOf<SharedVerdictSeverity>();

    const fromShared: SharedVerdict = {
      toolName: 'list_olts',
      code: 'ok',
      reason: 'fresh-complete',
      severity: 'ok',
    };
    const asEvidence: Evidence.Verdict = fromShared;
    const backToShared: SharedVerdict = asEvidence;
    const agentResult: AgentResult = {
      text: 'ok',
      toolCalls: [],
      verdicts: [asEvidence],
    };

    expect(backToShared).toEqual(fromShared);
    expect(agentResult.verdicts).toEqual([fromShared]);
  });

  it('keeps the canonical VerdictCode and VerdictSeverity enum values aligned with TruthGate outputs', () => {
    expect(VerdictCodeSchema.options).toEqual(['ok', 'low_confidence', 'stale', 'incomplete']);
    expect(VerdictSeveritySchema.options).toEqual(['ok', 'info', 'warning', 'critical']);

    const observedAt = '2026-09-01T12:00:00.000Z';
    const freshNow = new Date('2026-09-01T12:01:00.000Z');
    const staleNow = new Date('2026-09-01T12:30:00.000Z');

    const okVerdict: SharedVerdict = Evidence.classifyEnvelope(
      {
        schema: EVIDENCE_PROVENANCE_SCHEMA,
        source: 'smartolt',
        tenantId: 't1',
        observedAt,
        ttlMs: 900_000,
        completeness: 'complete',
        confidence: 1,
        data: [],
      },
      'list_olts',
      freshNow,
    );

    const lowConfidenceVerdict: SharedVerdict = Evidence.classifyEnvelope(
      {
        schema: EVIDENCE_PROVENANCE_SCHEMA,
        source: 'smartolt',
        tenantId: 't1',
        observedAt,
        ttlMs: 900_000,
        completeness: 'complete',
        confidence: 0.2,
        data: [],
      },
      'list_olts',
      freshNow,
    );

    const staleVerdict: SharedVerdict = Evidence.classifyEnvelope(
      {
        schema: EVIDENCE_PROVENANCE_SCHEMA,
        source: 'smartolt',
        tenantId: 't1',
        observedAt,
        ttlMs: 900_000,
        completeness: 'complete',
        confidence: 1,
        data: [],
      },
      'list_olts',
      staleNow,
    );

    const incompleteVerdict: SharedVerdict = Evidence.classifyUnwrapped('get_onu_detail');

    const verdicts = [okVerdict, lowConfidenceVerdict, staleVerdict, incompleteVerdict];
    expect(verdicts.map((v) => v.code)).toEqual(['ok', 'low_confidence', 'stale', 'incomplete']);

    for (const v of verdicts) {
      expect(VerdictCodeSchema.safeParse(v.code).success).toBe(true);
      expect(VerdictSeveritySchema.safeParse(v.severity).success).toBe(true);
    }
  });
});
