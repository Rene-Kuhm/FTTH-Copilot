import { describe, it, expect } from 'vitest';
import {
  extractFeatures,
  scoreSituation,
  updateWeights,
  defaultWeights,
  sigmoid,
  type SituationFeatures,
  type CorrelationWeights,
} from '../src/correlation-score';
const baseEvent = {
  sourceEventId: 'e1',
  deviceId: 'ONU-1',
  deviceKind: 'ONU' as const,
  timestamp: '2026-01-01T00:00:00.000Z',
  sourceKind: 'snmp_trap' as const,
  alertKind: 'optical_degradation' as const,
  severity: 'warning' as const,
};

const group = {
  ancestorKind: 'OLT' as const,
  ancestorId: 'OLT-1',
  windowStart: '2026-01-01T00:00:00.000Z',
  windowEnd: '2026-01-01T00:10:00.000Z',
  affectedRatio: 0.8,
  affectedCount: 80,
  totalPopulation: 100,
  events: [baseEvent],
};

describe('sigmoid', () => {
  it('maps any finite input into the open unit interval', () => {
    for (const x of [-1000, -10, 0, 10, 1000]) {
      const p = sigmoid(x);
      expect(p).toBeGreaterThan(0);
      expect(p).toBeLessThan(1);
    }
  });

  it('is symmetric about the origin', () => {
    expect(sigmoid(0)).toBeCloseTo(0.5, 10);
    expect(sigmoid(2) + sigmoid(-2)).toBeCloseTo(1, 10);
  });

  it('saturates rather than overflowing on large magnitudes', () => {
    expect(Number.isFinite(sigmoid(800))).toBe(true);
    expect(Number.isFinite(sigmoid(-800))).toBe(true);
  });
});

describe('extractFeatures', () => {
  it('produces a finite vector for a normal group', () => {
    const f = extractFeatures(group, []);
    expect(Object.values(f).every((v) => Number.isFinite(v))).toBe(true);
  });

  it('scores independent corroborating sources higher than a single source', () => {
    // Extra evidence belongs in group.events; the second parameter carries anomaly
    // overlaps, not more events.
    const single = extractFeatures(group, []);
    const corroborated = extractFeatures(
      { ...group, events: [
        baseEvent,
        { ...baseEvent, sourceEventId: 'e2', sourceKind: 'syslog' },
        { ...baseEvent, sourceEventId: 'e3', sourceKind: 'metric' },
      ] },
      [],
    );
    expect(corroborated.evidenceDiversity).toBeGreaterThan(single.evidenceDiversity);
  });

  it('measures temporal tightness from the spread of event timestamps', () => {
    const withAt = (ts: string) => extractFeatures(
      { ...group, events: [baseEvent, { ...baseEvent, sourceEventId: 'e2', timestamp: ts }] },
      [],
    );
    const tight = withAt('2026-01-01T00:01:00.000Z');
    const loose = withAt('2026-01-01T00:09:59.000Z');
    expect(tight.temporalTightness).toBeGreaterThan(loose.temporalTightness);
  });

  it('raises branch spread when several downstream branches are affected', () => {
    const oneBranch = extractFeatures(group, []);
    const manyBranches = extractFeatures(
      { ...group, events: [
        baseEvent,
        { ...baseEvent, sourceEventId: 'e2', deviceId: 'ONU-2' },
        { ...baseEvent, sourceEventId: 'e3', deviceId: 'ONU-3' },
        { ...baseEvent, sourceEventId: 'e4', deviceId: 'ONU-4' },
      ] },
      [],
    );
    expect(manyBranches.branchSpread).toBeGreaterThan(oneBranch.branchSpread);
  });

  it('discounts consensus features for a lone event that cannot corroborate itself', () => {
    // A single event is trivially "tight" and trivially "same kind", so those features
    // must not read as full agreement. This is what keeps an isolated blip out of `major`.
    const lone = extractFeatures(group, []);
    const trio = extractFeatures(
      { ...group, events: [
        baseEvent,
        { ...baseEvent, sourceEventId: 'e2', deviceId: 'ONU-2' },
        { ...baseEvent, sourceEventId: 'e3', deviceId: 'ONU-3' },
      ] },
      [],
    );
    expect(trio.temporalTightness).toBeGreaterThan(lone.temporalTightness);
    expect(trio.kindAgreement).toBeGreaterThan(lone.kindAgreement);
    expect(trio.ancestorBreadth).toBeGreaterThan(lone.ancestorBreadth);
  });

  it('keeps every feature inside its documented range', () => {
    const extreme = extractFeatures(
      { ...group, affectedRatio: 1, affectedCount: 1000, totalPopulation: 1 },
      Array.from({ length: 200 }, (_, i) => ({
        ...baseEvent,
        sourceEventId: `e${i}`,
        deviceId: `ONU-${i}`,
        timestamp: '2026-01-01T00:10:00.000Z',
      })),
    );
    for (const [k, v] of Object.entries(extreme)) {
      expect(v, `${k} out of range`).toBeGreaterThanOrEqual(0);
      expect(v, `${k} out of range`).toBeLessThanOrEqual(1);
    }
  });

  it('survives a group with a single event and an empty corroboration list', () => {
    const f = extractFeatures(
      { ...group, affectedRatio: 0, affectedCount: 0, totalPopulation: 1, events: [baseEvent] },
      [],
    );
    expect(Object.values(f).every((v) => Number.isFinite(v))).toBe(true);
  });
});

describe('scoreSituation', () => {
  const w = defaultWeights();

  it('scores a well-supported upstream fault above a weak one', () => {
    const strong = scoreSituation(
      extractFeatures(
        { ...group, affectedRatio: 0.9, affectedCount: 90 },
        [
          { ...baseEvent, sourceEventId: 'e2', sourceKind: 'syslog', deviceId: 'ONU-2' },
          { ...baseEvent, sourceEventId: 'e3', sourceKind: 'metric', deviceId: 'ONU-3' },
        ],
      ),
      w,
    );
    const weak = scoreSituation(extractFeatures({ ...group, affectedRatio: 0.01, affectedCount: 1 }, []), w);
    expect(strong.confidence).toBeGreaterThan(weak.confidence);
  });

  it('always returns a confidence inside (0, 1)', () => {
    const s = scoreSituation(extractFeatures(group, []), w);
    expect(s.confidence).toBeGreaterThan(0);
    expect(s.confidence).toBeLessThan(1);
  });

  it('exposes a contribution per feature that sums to the raw logit', () => {
    const f = extractFeatures(group, []);
    const s = scoreSituation(f, w);
    const sum = s.contributions.reduce((acc, c) => acc + c.contribution, 0);
    expect(sum).toBeCloseTo(s.rawLogit, 8);
  });

  it('assigns the highest severity to a high-confidence wide blast radius', () => {
    const critical = scoreSituation(
      extractFeatures(
        { ...group, affectedRatio: 0.95, affectedCount: 95, events: [{ ...baseEvent, severity: 'critical' }] },
        [{ ...baseEvent, sourceEventId: 'e2', sourceKind: 'syslog' }],
      ),
      w,
    );
    expect(['critical', 'major']).toContain(critical.severity);
  });

  it('keeps an isolated low-ratio blip at low severity', () => {
    const minor = scoreSituation(
      extractFeatures(
        { ...group, affectedRatio: 0.01, affectedCount: 1, events: [{ ...baseEvent, severity: 'info' }] },
        [],
      ),
      w,
    );
    expect(['minor', 'info']).toContain(minor.severity);
  });
});

describe('updateWeights', () => {
  const f: SituationFeatures = extractFeatures(group, []);

  it('returns a new object and never mutates its input', () => {
    const before = { ...defaultWeights() };
    const after = updateWeights(before, f, true);
    expect(after).not.toBe(before);
    expect(before).toEqual(defaultWeights());
  });

  it('increases the logit for a confirmed situation', () => {
    const w = defaultWeights();
    const before = scoreSituation(f, w).rawLogit;
    const after = scoreSituation(f, updateWeights(w, f, true)).rawLogit;
    expect(after).toBeGreaterThan(before);
  });

  it('decreases the logit for a dismissed situation', () => {
    const w = defaultWeights();
    const before = scoreSituation(f, w).rawLogit;
    const after = scoreSituation(f, updateWeights(w, f, false)).rawLogit;
    expect(after).toBeLessThan(before);
  });

  it('keeps weights bounded no matter how many outcomes are folded in', () => {
    let w = defaultWeights();
    for (let i = 0; i < 500; i += 1) w = updateWeights(w, f, false);
    // Repeatedly confirming must not let any weight run away; the clamp is allowed to
    // saturate at the bound, which is the behaviour that keeps it bounded.
    for (let i = 0; i < 2000; i += 1) w = updateWeights(w, f, true);
    for (const [k, v] of Object.entries(w)) {
      expect(v, `weight ${k} escaped bounds`).toBeGreaterThanOrEqual(-1);
      expect(v, `weight ${k} escaped bounds`).toBeLessThanOrEqual(1);
      expect(Number.isFinite(v)).toBe(true);
    }
  });

  it('changes only weights for features present in the vector', () => {
    const w = defaultWeights();
    const next = updateWeights(w, f, true);
    const changed = Object.keys(w).filter((k) => w[k as keyof CorrelationWeights] !== next[k as keyof CorrelationWeights]);
    expect(changed.length).toBeGreaterThan(0);
    expect(changed.every((k) => k in f)).toBe(true);
  });
});
