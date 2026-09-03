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
  // Inject a `now` close to observedAt so the staleness dimension
  // does not contaminate these confidence-only tests.
  const freshNow = new Date('2026-08-30T12:05:00.000Z');

  it('returns low_confidence/missing-confidence when confidence field is absent', () => {
    const verdict = classifyEnvelope(baseEnvelope, 'list_olts', freshNow);
    expect(verdict.code).toBe('low_confidence');
    expect(verdict.reason).toBe('missing-confidence');
    expect(verdict.severity).toBe('warning');
    expect(verdict.toolName).toBe('list_olts');
  });

  it('returns low_confidence/low-confidence-value for confidence strictly below 0.3', () => {
    const verdict = classifyEnvelope({ ...baseEnvelope, confidence: 0.2 }, 'list_olts', freshNow);
    expect(verdict.code).toBe('low_confidence');
    expect(verdict.reason).toBe('low-confidence-value');
    expect(verdict.severity).toBe('warning');
  });

  it('returns ok for confidence exactly at the 0.3 threshold (inclusive)', () => {
    const verdict = classifyEnvelope({ ...baseEnvelope, confidence: 0.3 }, 'list_olts', freshNow);
    expect(verdict.code).toBe('ok');
    expect(verdict.reason).toBe('fresh-complete');
    expect(verdict.severity).toBe('ok');
  });

  it('returns ok for confidence 1.0', () => {
    const verdict = classifyEnvelope({ ...baseEnvelope, confidence: 1.0 }, 'list_olts', freshNow);
    expect(verdict.code).toBe('ok');
    expect(verdict.reason).toBe('fresh-complete');
  });

  it('returns low_confidence for confidence 0.0', () => {
    const verdict = classifyEnvelope({ ...baseEnvelope, confidence: 0 }, 'list_olts', freshNow);
    expect(verdict.code).toBe('low_confidence');
    expect(verdict.reason).toBe('low-confidence-value');
  });
});

describe('classifyEnvelope — staleness dimension', () => {
  const baseEnvelope = {
    schema: EVIDENCE_PROVENANCE_SCHEMA,
    source: 'smartolt.poll',
    tenantId: 't1',
    completeness: 'complete' as const,
    confidence: 1.0,
    data: [],
  };

  it('does not mark a 5-minute-old envelope with ttlMs=900000 as stale', () => {
    const observedAt = '2026-08-30T12:00:00.000Z';
    const now = new Date('2026-08-30T12:05:00.000Z');
    const verdict = classifyEnvelope({ ...baseEnvelope, observedAt, ttlMs: 900000 }, 'list_olts', now);
    expect(verdict.code).not.toBe('stale');
    expect(verdict.code).toBe('ok');
  });

  it('marks a 20-minute-old envelope with ttlMs=900000 as stale/expired-ttl/warning', () => {
    const observedAt = '2026-08-30T12:00:00.000Z';
    const now = new Date('2026-08-30T12:20:00.000Z');
    const verdict = classifyEnvelope({ ...baseEnvelope, observedAt, ttlMs: 900000 }, 'list_olts', now);
    expect(verdict.code).toBe('stale');
    expect(verdict.reason).toBe('expired-ttl');
    expect(verdict.severity).toBe('warning');
  });

  it('treats edge equality (now === observedAt + ttlMs) as fresh, not stale', () => {
    const observedAt = '2026-08-30T12:00:00.000Z';
    const now = new Date(new Date(observedAt).getTime() + 900000);
    const verdict = classifyEnvelope({ ...baseEnvelope, observedAt, ttlMs: 900000 }, 'list_olts', now);
    expect(verdict.code).not.toBe('stale');
    expect(verdict.code).toBe('ok');
  });

  it('marks envelope as stale one millisecond past the TTL boundary', () => {
    const observedAt = '2026-08-30T12:00:00.000Z';
    const now = new Date(new Date(observedAt).getTime() + 900001);
    const verdict = classifyEnvelope({ ...baseEnvelope, observedAt, ttlMs: 900000 }, 'list_olts', now);
    expect(verdict.code).toBe('stale');
  });
});

describe('classifyEnvelope — completeness dimension', () => {
  const baseEnvelope = {
    schema: EVIDENCE_PROVENANCE_SCHEMA,
    source: 'smartolt.poll',
    tenantId: 't1',
    observedAt: '2026-08-30T12:00:00.000Z',
    ttlMs: 900000,
    confidence: 1.0,
    data: [],
  };
  const freshNow = new Date('2026-08-30T12:05:00.000Z');

  it("returns ok for completeness='complete'", () => {
    const verdict = classifyEnvelope(
      { ...baseEnvelope, completeness: 'complete' },
      'list_olts',
      freshNow,
    );
    expect(verdict.code).toBe('ok');
    expect(verdict.reason).toBe('fresh-complete');
    expect(verdict.severity).toBe('ok');
  });

  it("returns incomplete/partial-completeness/warning for completeness='partial'", () => {
    const verdict = classifyEnvelope(
      { ...baseEnvelope, completeness: 'partial' },
      'list_olts',
      freshNow,
    );
    expect(verdict.code).toBe('incomplete');
    expect(verdict.reason).toBe('partial-completeness');
    expect(verdict.severity).toBe('warning');
  });

  it("returns incomplete/minimal-completeness/critical for completeness='minimal'", () => {
    const verdict = classifyEnvelope(
      { ...baseEnvelope, completeness: 'minimal' },
      'list_olts',
      freshNow,
    );
    expect(verdict.code).toBe('incomplete');
    expect(verdict.reason).toBe('minimal-completeness');
    expect(verdict.severity).toBe('critical');
  });
});