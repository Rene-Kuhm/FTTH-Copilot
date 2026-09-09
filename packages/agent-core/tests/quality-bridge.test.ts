import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SOURCE_POLICIES,
  type QualitySample,
} from '@ftth-copilot/evidence';
import { qualityVerdictFromToolSamples } from '../src/quality-bridge';

const NOW = Date.parse('2026-09-08T12:00:00.000Z');
const POLL = DEFAULT_SOURCE_POLICIES[0]!;

function s(t: number, value?: number): QualitySample {
  return { sampledAt: t, value };
}

describe('qualityVerdictFromToolSamples — TruthGate bridge (2.5)', () => {
  it('maps a healthy series to a Verdict that appends to AgentResult.verdicts', () => {
    const { verdict, result } = qualityVerdictFromToolSamples({
      toolName: 'list_onus',
      samples: [s(NOW - 180_000), s(NOW - 120_000), s(NOW - 60_000)],
      policy: POLL,
      nowMs: NOW,
    });
    expect(verdict).toEqual({
      toolName: 'list_onus',
      code: 'ok',
      reason: 'fresh',
      severity: 'ok',
    });
    expect(result.level).toBe('fresh');
    expect(result.policyApplied).toBe(true);
  });

  it('maps a stale series to the stale Verdict code (warning severity)', () => {
    const { verdict } = qualityVerdictFromToolSamples({
      toolName: 'list_onus',
      samples: [s(NOW - 10 * 60_000)],
      policy: POLL,
      nowMs: NOW,
    });
    expect(verdict.code).toBe('stale');
    expect(verdict.severity).toBe('warning');
    expect(verdict.reason).toBe('stale');
  });

  it('maps a collector hole to incomplete/critical with unknown-gap reason', () => {
    const { verdict } = qualityVerdictFromToolSamples({
      toolName: 'list_onus',
      samples: [
        s(NOW - 25 * 60_000),
        s(NOW - 15 * 60_000),
        s(NOW - 5 * 60_000),
      ],
      policy: POLL,
      nowMs: NOW,
    });
    expect(verdict.code).toBe('incomplete');
    expect(verdict.severity).toBe('critical');
    expect(verdict.reason).toBe('unknown-gap');
  });

  it('maps a future sample to error/incomplete (rejected series)', () => {
    const { verdict } = qualityVerdictFromToolSamples({
      toolName: 'list_onus',
      samples: [s(NOW + 5 * 60_000)],
      policy: POLL,
      nowMs: NOW,
    });
    expect(verdict.code).toBe('incomplete');
    expect(verdict.severity).toBe('critical');
    expect(verdict.reason).toBe('future-sample');
  });

  it('maps zero samples to stale-no-sample (collector down, not device-down)', () => {
    const { verdict, result } = qualityVerdictFromToolSamples({
      toolName: 'list_onus',
      samples: [],
      policy: POLL,
      nowMs: NOW,
    });
    expect(result.level).toBe('unknown');
    expect(result.reason).toBe('stale-no-sample');
    expect(verdict.reason).toBe('stale-no-sample');
    expect(verdict.code).toBe('incomplete');
    expect(verdict.severity).toBe('critical');
  });

  it('is idempotent — same inputs produce the same Verdict (TDD discipline)', () => {
    const a = qualityVerdictFromToolSamples({
      toolName: 'list_onus',
      samples: [s(NOW - 120_000), s(NOW - 60_000)],
      policy: POLL,
      nowMs: NOW,
    });
    const b = qualityVerdictFromToolSamples({
      toolName: 'list_onus',
      samples: [s(NOW - 120_000), s(NOW - 60_000)],
      policy: POLL,
      nowMs: NOW,
    });
    expect(a.verdict).toEqual(b.verdict);
    expect(a.result).toEqual(b.result);
  });

  it('the Verdict shape matches what classifyEnvelope produces (no schema change)', () => {
    // Bridge output must be structurally identical to a classifyEnvelope
    // verdict (the four fields, the closed string-union values).
    const { verdict } = qualityVerdictFromToolSamples({
      toolName: 'list_onus',
      samples: [s(NOW - 60_000)],
      policy: POLL,
      nowMs: NOW,
    });
    expect(Object.keys(verdict).sort()).toEqual(['code', 'reason', 'severity', 'toolName']);
    expect(['ok', 'low_confidence', 'stale', 'incomplete']).toContain(verdict.code);
    expect(['ok', 'info', 'warning', 'critical']).toContain(verdict.severity);
  });
});
