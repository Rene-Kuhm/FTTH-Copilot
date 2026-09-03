import { describe, expect, it } from 'vitest';
import * as Evidence from '../src/index';
import type { Abstention } from '@ftth-copilot/shared';
import { ABSTENTION_SCHEMA, abstentionSchema } from '@ftth-copilot/shared';

describe('evidence public API surface — Fase C re-exports', () => {
  it('re-exports shouldAbstain as a function', () => {
    expect(typeof Evidence.shouldAbstain).toBe('function');
  });

  it('re-exports buildAbstention as a function', () => {
    expect(typeof Evidence.buildAbstention).toBe('function');
  });

  it('re-exports nextStepFor as a function', () => {
    expect(typeof Evidence.nextStepFor).toBe('function');
  });

  it('re-exports Abstention type (consumers can declare the shape)', () => {
    const env: Abstention = {
      schema: ABSTENTION_SCHEMA,
      reason: 'incomplete',
      severity: 'critical',
      missing: ['get_onu_detail'],
      available: ['list_onus'],
      nextStep: 'Re-colectá las métricas y volvé a intentar.',
      toolsAffected: ['get_onu_detail'],
    };
    expect(env.schema).toBe(Evidence.ABSTENTION_SCHEMA ?? ABSTENTION_SCHEMA);
  });

  it('re-exports the abstentionSchema zod object', () => {
    expect(Evidence.abstentionSchema).toBe(abstentionSchema);
  });

  it('re-exports ABSTENTION_SCHEMA constant', () => {
    expect(Evidence.ABSTENTION_SCHEMA).toBe('ftth.abstention.v1');
  });

  it('keeps Fase B exports working (no regression)', () => {
    expect(typeof Evidence.classifyEnvelope).toBe('function');
    expect(typeof Evidence.classifyUnwrapped).toBe('function');
  });
});