import { describe, expect, it } from 'vitest';
import * as Shared from '../src/index';

describe('shared public API surface — Fase C re-exports', () => {
  it('re-exports ABSTENTION_SCHEMA constant', () => {
    expect(Shared.ABSTENTION_SCHEMA).toBe('ftth.abstention.v1');
  });

  it('re-exports abstentionSchema zod schema', () => {
    expect(typeof Shared.abstentionSchema).toBe('object');
    expect(typeof Shared.abstentionSchema.safeParse).toBe('function');
  });

  it('exposes the Abstention type at the package boundary', () => {
    const env: Shared.Abstention = {
      schema: Shared.ABSTENTION_SCHEMA,
      reason: 'incomplete',
      severity: 'critical',
      missing: ['get_onu_detail'],
      available: ['list_onus'],
      nextStep: 'Re-colectá las métricas y volvé a intentar.',
      toolsAffected: ['get_onu_detail'],
    };
    expect(env.schema).toBe('ftth.abstention.v1');
  });
});