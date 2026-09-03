import { describe, expect, it } from 'vitest';
import { classifyUnwrapped, classifyEnvelope } from '../src/truth-gate';
import { EVIDENCE_PROVENANCE_SCHEMA } from '@ftth-copilot/shared';

describe('classifyUnwrapped', () => {
  it.each(['list_olts', 'get_olt_detail', 'list_onus', 'unknown_tool'])(
    'returns no-envelope incomplete verdict for tool %s',
    (toolName) => {
      const verdict = classifyUnwrapped(toolName);
      expect(verdict).toEqual({
        toolName,
        code: 'incomplete',
        reason: 'no-envelope',
        severity: 'critical',
      });
    },
  );

  it('does not throw when toolName is empty', () => {
    const verdict = classifyUnwrapped('');
    expect(verdict.toolName).toBe('');
    expect(verdict.code).toBe('incomplete');
    expect(verdict.reason).toBe('no-envelope');
    expect(verdict.severity).toBe('critical');
  });
});

describe('classifyEnvelope — confidence dimension', () => {
  const baseEnvelope = {
    schema: EVIDENCE_PROVENANCE_SCHEMA,
    source: 'smartolt.poll',
    tenantId: 't1',
    observedAt: '2026-08-30T12:00:00.000Z',
    ttlMs: 900000,
    completeness: 'complete' as const,
    data: [],
  };

  it('returns low_confidence/missing-confidence when confidence field is absent', () => {
    const verdict = classifyEnvelope(baseEnvelope, 'list_olts');
    expect(verdict.code).toBe('low_confidence');
    expect(verdict.reason).toBe('missing-confidence');
    expect(verdict.severity).toBe('warning');
    expect(verdict.toolName).toBe('list_olts');
  });

  it('returns low_confidence/low-confidence-value for confidence strictly below 0.3', () => {
    const verdict = classifyEnvelope({ ...baseEnvelope, confidence: 0.2 }, 'list_olts');
    expect(verdict.code).toBe('low_confidence');
    expect(verdict.reason).toBe('low-confidence-value');
    expect(verdict.severity).toBe('warning');
  });

  it('returns ok for confidence exactly at the 0.3 threshold (inclusive)', () => {
    const verdict = classifyEnvelope({ ...baseEnvelope, confidence: 0.3 }, 'list_olts');
    expect(verdict.code).toBe('ok');
    expect(verdict.reason).toBe('fresh-complete');
    expect(verdict.severity).toBe('ok');
  });

  it('returns ok for confidence 1.0', () => {
    const verdict = classifyEnvelope({ ...baseEnvelope, confidence: 1.0 }, 'list_olts');
    expect(verdict.code).toBe('ok');
    expect(verdict.reason).toBe('fresh-complete');
  });

  it('returns low_confidence for confidence 0.0', () => {
    const verdict = classifyEnvelope({ ...baseEnvelope, confidence: 0 }, 'list_olts');
    expect(verdict.code).toBe('low_confidence');
    expect(verdict.reason).toBe('low-confidence-value');
  });
});