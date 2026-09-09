import { describe, expect, it } from 'vitest';
import {
  assessFreshness,
  detectCounterReset,
  isMissingValue,
  toQualityVerdict,
  DEFAULT_SOURCE_POLICIES,
  type QualitySample,
  type SourcePolicy,
} from '../src/evidence-quality';

const NOW = Date.parse('2026-09-08T12:00:00.000Z');

const POLL_POLICY: SourcePolicy = DEFAULT_SOURCE_POLICIES[0]!;

function sample(t: number | string, value?: number | null): QualitySample {
  return { sampledAt: t, value };
}

describe('assessFreshness — cero/una muestra', () => {
  it('no samples → unknown (stale-no-sample), never device-down', () => {
    const r = assessFreshness([], POLL_POLICY, NOW);
    expect(r.level).toBe('unknown');
    expect(r.reason).toBe('stale-no-sample');
    expect(r.newestAgeMs).toBeNull();
    expect(r.sampleCount).toBe(0);
  });

  it('one fresh sample below minSamples → insufficient', () => {
    const r = assessFreshness([sample(NOW - 30_000, 1)], POLL_POLICY, NOW);
    expect(r.level).toBe('insufficient');
    expect(r.reason).toBe('insufficient-samples');
    expect(r.sampleCount).toBe(1);
  });

  it('one old sample beyond TTL → stale', () => {
    const r = assessFreshness([sample(NOW - 10 * 60_000, 1)], POLL_POLICY, NOW);
    expect(r.level).toBe('stale');
    expect(r.reason).toBe('stale');
    expect(r.newestAgeMs).toBe(10 * 60_000);
  });
});

describe('assessFreshness — hueco interno (2.3)', () => {
  it('gap longer than maxGapMs inside window → unknown, even with samples at both ends', () => {
    // 3 samples, all inside TTL, but a 10-minute hole between t1 and t2.
    const r = assessFreshness(
      [
        sample(NOW - 5 * 60_000, 1),
        sample(NOW - 15 * 60_000, 2), // gap to next = 10 min > 3 min
        sample(NOW - 25 * 60_000, 3),
      ],
      POLL_POLICY,
      NOW,
    );
    expect(r.level).toBe('unknown');
    expect(r.reason).toBe('unknown-gap');
  });

  it('gap within tolerance → fresh', () => {
    const r = assessFreshness(
      [
        sample(NOW - 180_000, 3),
        sample(NOW - 120_000, 2),
        sample(NOW - 60_000, 1),
      ],
      POLL_POLICY,
      NOW,
    );
    expect(r.level).toBe('fresh');
    expect(r.reason).toBe('fresh');
  });
});

describe('assessFreshness — eventos fuera de orden o en el futuro', () => {
  it('future sample → error', () => {
    const r = assessFreshness(
      [
        sample(NOW - 60_000, 1),
        sample(NOW + 2 * 60_000, 2),
      ],
      POLL_POLICY,
      NOW,
    );
    expect(r.level).toBe('error');
    expect(r.reason).toBe('future-sample');
  });

  it('out-of-order samples (clock jitter) still report fresh via recovered', () => {
    const r = assessFreshness(
      [
        sample(NOW - 180_000, 3),
        sample(NOW - 60_000, 1),
        sample(NOW - 120_000, 2),
      ],
      POLL_POLICY,
      NOW,
    );
    expect(r.level).toBe('fresh');
    expect(r.reason).toBe('recovered');
  });
});

describe('assessFreshness — reloj controlado y datos antiguos', () => {
  it('newest exactly at TTL boundary is fresh (inclusive)', () => {
    const r = assessFreshness(
      [
        sample(NOW - 300_000, 1),
        sample(NOW - 240_000, 2),
        sample(NOW - 180_000, 3),
      ],
      POLL_POLICY,
      NOW,
    );
    expect(r.level).toBe('fresh');
  });

  it('newest just past TTL is stale', () => {
    const r = assessFreshness(
      [sample(NOW - 301_000, 1)],
      POLL_POLICY,
      NOW,
    );
    expect(r.level).toBe('stale');
  });

  it('ancient data far beyond TTL → stale, no fabricated recovery', () => {
    const r = assessFreshness(
      [sample(NOW - 3 * 24 * 3600_000, 1)],
      POLL_POLICY,
      NOW,
    );
    expect(r.level).toBe('stale');
    expect(r.reason).toBe('stale');
  });
});

describe('detectCounterReset — contador reiniciado', () => {
  it('returns the index of the first backwards jump', () => {
    const r = detectCounterReset([
      sample(NOW - 180_000, 100),
      sample(NOW - 120_000, 120),
      sample(NOW - 60_000, 80), // reset
      sample(NOW, 90),
    ]);
    expect(r).toBe(2);
  });

  it('monotonic series → null', () => {
    const r = detectCounterReset([
      sample(NOW - 180_000, 100),
      sample(NOW - 120_000, 120),
      sample(NOW - 60_000, 140),
    ]);
    expect(r).toBeNull();
  });

  it('null values are skipped, not treated as a reset', () => {
    const r = detectCounterReset([
      sample(NOW - 180_000, 100),
      sample(NOW - 120_000, null),
      sample(NOW - 60_000, 140),
    ]);
    expect(r).toBeNull();
  });
});

describe('isMissingValue — campo no soportado / valores ausentes', () => {
  it('numeric metric with neither value nor valueText → missing', () => {
    expect(isMissingValue({ sampledAt: NOW }, true)).toBe(true);
  });

  it('numeric metric with value → present', () => {
    expect(isMissingValue(sample(NOW, 1), true)).toBe(false);
  });

  it('categorical metric with valueText → present', () => {
    expect(
      isMissingValue({ sampledAt: NOW, valueText: 'online' }, false),
    ).toBe(false);
  });

  it('categorical metric without valueText → missing', () => {
    expect(isMissingValue({ sampledAt: NOW }, false)).toBe(true);
  });
});

describe('toQualityVerdict — TruthGate bridge (2.5)', () => {
  it('fresh → ok/ok', () => {
    const v = toQualityVerdict({
      toolName: 'list_onus',
      result: assessFreshness(
        [
          sample(NOW - 180_000, 3),
          sample(NOW - 120_000, 2),
          sample(NOW - 60_000, 1),
        ],
        POLL_POLICY,
        NOW,
      ),
    });
    expect(v).toEqual({
      toolName: 'list_onus',
      code: 'ok',
      reason: 'fresh',
      severity: 'ok',
    });
  });

  it('stale → stale/warning', () => {
    const v = toQualityVerdict({
      toolName: 'list_onus',
      result: assessFreshness([sample(NOW - 10 * 60_000, 1)], POLL_POLICY, NOW),
    });
    expect(v.code).toBe('stale');
    expect(v.severity).toBe('warning');
  });

  it('unknown-gap → incomplete/critical (collector hole, not device)', () => {
    const v = toQualityVerdict({
      toolName: 'list_onus',
      result: assessFreshness(
        [
          sample(NOW - 5 * 60_000, 1),
          sample(NOW - 15 * 60_000, 2),
          sample(NOW - 25 * 60_000, 3),
        ],
        POLL_POLICY,
        NOW,
      ),
    });
    expect(v.code).toBe('incomplete');
    expect(v.severity).toBe('critical');
    expect(v.reason).toBe('unknown-gap');
  });
});

describe('default policies (2.1), documented configuration', () => {
  it('contains the three expected source families', () => {
    const sources = DEFAULT_SOURCE_POLICIES.map((p) => p.source);
    expect(sources).toContain('smartolt.poll');
    expect(sources).toContain('fec');
    expect(sources).toContain('syslog');
  });

  it('syslog is event-driven (no cadence, no TTL, no min samples)', () => {
    const syslog = DEFAULT_SOURCE_POLICIES.find((p) => p.source === 'syslog');
    expect(syslog).toBeDefined();
    expect(syslog!.expectedCadenceMs).toBe(0);
    expect(syslog!.ttlMs).toBe(0);
    expect(syslog!.minSamples).toBe(0);
  });
});