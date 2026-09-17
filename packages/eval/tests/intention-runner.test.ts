/**
 * Block 2 (diagnostic-router) — intention runner + thresholds tests.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  INTENTION_ACCURACY_THRESHOLD,
  INTENTION_FALSE_ROUTING_THRESHOLD,
  isAdjacent,
  runIntentionCase,
  runIntentionCorpus,
} from '../src/intention-runner';
import {
  deriveThresholds,
  isGateValidForRedCorpus,
  DEFAULT_CONFIDENCE_GATE,
  DEFAULT_MAX_TOKEN_BUDGET,
} from '../src/intention-thresholds';
import {
  intentionCorpusSchema,
  type IntentionCorpus,
} from '../src/intention-schema';

function loadCorpus(): IntentionCorpus {
  const path = resolve(__dirname, '..', 'corpus', 'intentions.json');
  const raw = JSON.parse(readFileSync(path, 'utf-8'));
  return intentionCorpusSchema.parse(raw);
}

describe('isAdjacent', () => {
  it('same label is adjacent', () => {
    expect(isAdjacent('incident_diagnosis', 'incident_diagnosis')).toBe(true);
  });
  it('incident_diagnosis ↔ routine_topology is adjacent', () => {
    expect(isAdjacent('incident_diagnosis', 'routine_topology')).toBe(true);
    expect(isAdjacent('routine_topology', 'incident_diagnosis')).toBe(true);
  });
  it('advisory is never adjacent', () => {
    expect(isAdjacent('advisory', 'incident_diagnosis')).toBe(false);
    expect(isAdjacent('advisory', 'routine_topology')).toBe(false);
    expect(isAdjacent('advisory', 'advisory')).toBe(true); // same label
  });
});

describe('intention corpus (intentions.json)', () => {
  it('parses and validates against intentionCorpusSchema', () => {
    const corpus = loadCorpus();
    expect(corpus.cases.length).toBeGreaterThanOrEqual(30);
  });

  it('covers all 7 surfaces', () => {
    const corpus = loadCorpus();
    const surfaces = new Set(corpus.cases.map((c) => c.surface));
    expect(surfaces.size).toBe(7);
    expect(surfaces.has('user-message')).toBe(true);
    expect(surfaces.has('conversation-history')).toBe(true);
    expect(surfaces.has('tool-args')).toBe(true);
    expect(surfaces.has('connector-payload')).toBe(true);
    expect(surfaces.has('retrieval-block')).toBe(true);
    expect(surfaces.has('system-assembly')).toBe(true);
    expect(surfaces.has('prediction-provider')).toBe(true);
  });

  it('covers all 3 intentions', () => {
    const corpus = loadCorpus();
    const intentions = new Set(corpus.cases.map((c) => c.expectedIntention));
    expect(intentions.size).toBe(3);
  });
});

describe('runIntentionCorpus', () => {
  it('produces ≥ 0.95 accuracy on the corpus', () => {
    const corpus = loadCorpus();
    const summary = runIntentionCorpus(corpus);
    expect(summary.accuracy).toBeGreaterThanOrEqual(INTENTION_ACCURACY_THRESHOLD);
  });

  it('produces 0 false routings on the corpus', () => {
    const corpus = loadCorpus();
    const summary = runIntentionCorpus(corpus);
    expect(summary.falseRoutedCount).toBeLessThanOrEqual(INTENTION_FALSE_ROUTING_THRESHOLD);
  });

  it('returns one result per case', () => {
    const corpus = loadCorpus();
    const summary = runIntentionCorpus(corpus);
    expect(summary.casesRun).toBe(corpus.cases.length);
    expect(summary.results).toHaveLength(corpus.cases.length);
  });

  it('records scores for every result', () => {
    const corpus = loadCorpus();
    const summary = runIntentionCorpus(corpus);
    for (const r of summary.results) {
      expect(r.scores).toBeDefined();
      expect(r.scores.incident_diagnosis).toBeGreaterThanOrEqual(0);
      expect(r.scores.routine_topology).toBeGreaterThanOrEqual(0);
      expect(r.scores.advisory).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('runIntentionCase', () => {
  it('marks incident_diagnosis as correct for LOi message', () => {
    const r = runIntentionCase({
      id: 'test-1',
      surface: 'user-message',
      userMessage: 'La ONU está en LOi hace 3 horas urgente',
      expectedIntention: 'incident_diagnosis',
    });
    expect(r.correct).toBe(true);
    expect(r.falseRouted).toBe(false);
  });

  it('flags advisory misclassification as false-routed', () => {
    // A clearly advisory message that should never be classified as
    // incident_diagnosis (would force LLM path when deterministic
    // could answer).
    const r = runIntentionCase({
      id: 'test-2',
      surface: 'user-message',
      userMessage: 'Cómo funciona el algoritmo de DBA en GPON',
      expectedIntention: 'advisory',
    });
    expect(r.correct).toBe(true);
    // If actual is incident_diagnosis, that's a false routing.
    if (r.actual === 'incident_diagnosis') {
      expect(r.falseRouted).toBe(true);
    } else {
      expect(r.falseRouted).toBe(false);
    }
  });
});

describe('deriveThresholds', () => {
  it('returns defaults when no distribution provided', () => {
    const t = deriveThresholds();
    expect(t.confidenceGate).toBe(DEFAULT_CONFIDENCE_GATE);
    expect(t.maxTokenBudget).toBe(DEFAULT_MAX_TOKEN_BUDGET);
    expect(t.sampleSize).toBe(0);
  });

  it('returns defaults when distribution is all zeros', () => {
    const t = deriveThresholds({ incident_diagnosis: 0, routine_topology: 0, advisory: 0 });
    expect(t.sampleSize).toBe(0);
    expect(t.confidenceGate).toBe(DEFAULT_CONFIDENCE_GATE);
  });

  it('shifts gate down as incident_diagnosis ratio grows', () => {
    const lowInc = deriveThresholds({ incident_diagnosis: 1, routine_topology: 99, advisory: 0 });
    const highInc = deriveThresholds({ incident_diagnosis: 90, routine_topology: 10, advisory: 0 });
    expect(highInc.confidenceGate).toBeLessThan(lowInc.confidenceGate);
  });

  it('returns sampleSize equal to sum of counts', () => {
    const t = deriveThresholds({ incident_diagnosis: 30, routine_topology: 50, advisory: 20 });
    expect(t.sampleSize).toBe(100);
  });

  it('clamps gate to a safe floor', () => {
    const t = deriveThresholds({ incident_diagnosis: 1000, routine_topology: 0, advisory: 0 });
    expect(t.confidenceGate).toBeGreaterThanOrEqual(0.3);
  });
});

describe('isGateValidForRedCorpus', () => {
  it('accepts gates in [0, 1]', () => {
    expect(isGateValidForRedCorpus(0)).toBe(true);
    expect(isGateValidForRedCorpus(0.5)).toBe(true);
    expect(isGateValidForRedCorpus(1)).toBe(true);
  });

  it('rejects out-of-range gates', () => {
    expect(isGateValidForRedCorpus(-0.1)).toBe(false);
    expect(isGateValidForRedCorpus(1.1)).toBe(false);
  });
});
