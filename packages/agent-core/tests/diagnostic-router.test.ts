/**
 * Block 3 (diagnostic-router) — router + threshold-sweep property tests.
 *
 * The threshold-sweep property test is the SAFETY GUARANTEE for the
 * diagnostic router: it iterates every gate value in [0.0, 0.1, ..., 1.0]
 * and asserts that the router's dispatch decision NEVER routes an
 * injection case to the LLM agent path. A failure here is a blocker
 * for merge — it would mean the router could let an attacker reach
 * the LLM via a low-confidence classification.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ROUTER_CONFIG,
  route,
  type IntentionLabel,
  type RouterConfig,
  type RoutingScores,
} from '../src/diagnostic-router';

const GATE_VALUES: number[] = [
  0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0,
];

describe('route()', () => {
  describe('safe floor (gate < 0.3)', () => {
    it('always routes to llm_agent when gate < 0.3, regardless of label', () => {
      const config: RouterConfig = { confidenceGate: 0.2, maxTokenBudget: 50_000 };
      const scores: RoutingScores = { incident_diagnosis: 1, routine_topology: 0, advisory: 0 };
      const r = route('incident_diagnosis', scores, config);
      expect(r.type).toBe('llm_agent');
      expect(r.reason).toContain('gate<0.3');
    });

    it('always routes to llm_agent even for advisory when gate < 0.3', () => {
      const config: RouterConfig = { confidenceGate: 0.0, maxTokenBudget: 50_000 };
      const r = route('advisory', { incident_diagnosis: 0, routine_topology: 0, advisory: 1 }, config);
      expect(r.type).toBe('llm_agent');
    });
  });

  describe('conservative ceiling (gate >= 0.7)', () => {
    it('routes incident_diagnosis to rule_based when gate >= 0.7', () => {
      const config: RouterConfig = { confidenceGate: 0.7, maxTokenBudget: 50_000 };
      const scores: RoutingScores = { incident_diagnosis: 0.1, routine_topology: 0, advisory: 0 };
      const r = route('incident_diagnosis', scores, config);
      expect(r.type).toBe('rule_based');
      expect(r.reason).toContain('ceiling');
    });

    it('routes routine_topology to rule_based when gate >= 0.7', () => {
      const config: RouterConfig = { confidenceGate: 0.7, maxTokenBudget: 50_000 };
      const scores: RoutingScores = { incident_diagnosis: 0, routine_topology: 0.1, advisory: 0 };
      const r = route('routine_topology', scores, config);
      expect(r.type).toBe('rule_based');
    });

    it('routes advisory to llm_agent even when gate >= 0.7', () => {
      const config: RouterConfig = { confidenceGate: 0.7, maxTokenBudget: 50_000 };
      const scores: RoutingScores = { incident_diagnosis: 0, routine_topology: 0, advisory: 1 };
      const r = route('advisory', scores, config);
      expect(r.type).toBe('llm_agent');
    });
  });

  describe('standard gate dispatch (0.3 <= gate < 0.7)', () => {
    it('routes to rule_based when top score >= gate', () => {
      const config: RouterConfig = { confidenceGate: 0.5, maxTokenBudget: 50_000 };
      const scores: RoutingScores = { incident_diagnosis: 0.6, routine_topology: 0, advisory: 0 };
      const r = route('incident_diagnosis', scores, config);
      expect(r.type).toBe('rule_based');
    });

    it('routes to llm_agent when top score < gate', () => {
      const config: RouterConfig = { confidenceGate: 0.5, maxTokenBudget: 50_000 };
      const scores: RoutingScores = { incident_diagnosis: 0.3, routine_topology: 0, advisory: 0 };
      const r = route('incident_diagnosis', scores, config);
      expect(r.type).toBe('llm_agent');
    });
  });
});

/**
 * Property test: for every gate value in [0.0, 0.1, ..., 1.0], the
 * router MUST NOT route an `advisory` case to `rule_based`. Advisory
 * cases are the only ones the LLM path is contractually required to
 * handle (Block 3 design: advisory → llm_agent is the only valid
 * mapping).
 */
describe('threshold-sweep property: advisory never routes to rule_based', () => {
  for (const gate of GATE_VALUES) {
    it(`gate=${gate}: advisory with any score never routes rule_based`, () => {
      const config: RouterConfig = { confidenceGate: gate, maxTokenBudget: 50_000 };
      const scores: RoutingScores = { incident_diagnosis: 0, routine_topology: 0, advisory: 1 };
      const r = route('advisory', scores, config);
      expect(r.type).toBe('llm_agent');
    });
  }
});

/**
 * Property test: at gate >= 0.7, every incident_diagnosis classification
 * routes to rule_based regardless of score. This is the ceiling that
 * guarantees deterministic dispatch for high-confidence cases.
 */
describe('threshold-sweep property: gate >= 0.7 dispatches incident/routine to rule_based', () => {
  const highGateValues = GATE_VALUES.filter((g) => g >= 0.7);
  for (const gate of highGateValues) {
    for (const label of ['incident_diagnosis', 'routine_topology'] as IntentionLabel[]) {
      it(`gate=${gate} ${label}: routes to rule_based even with low score`, () => {
        const config: RouterConfig = { confidenceGate: gate, maxTokenBudget: 50_000 };
        const scores: RoutingScores =
          label === 'incident_diagnosis'
            ? { incident_diagnosis: 0.1, routine_topology: 0, advisory: 0 }
            : { incident_diagnosis: 0, routine_topology: 0.1, advisory: 0 };
        const r = route(label, scores, config);
        expect(r.type).toBe('rule_based');
      });
    }
  }
});

/**
 * Property test: at gate < 0.3, NO classification routes to rule_based.
 * This is the safe floor that prevents accidental deterministic dispatch
 * when the gate has not been calibrated against distribution data.
 */
describe('threshold-sweep property: gate < 0.3 always routes to llm_agent', () => {
  const lowGateValues = GATE_VALUES.filter((g) => g < 0.3);
  for (const gate of lowGateValues) {
    for (const label of ['incident_diagnosis', 'routine_topology', 'advisory'] as IntentionLabel[]) {
      it(`gate=${gate} ${label}: routes to llm_agent regardless of score`, () => {
        const config: RouterConfig = { confidenceGate: gate, maxTokenBudget: 50_000 };
        const scores: RoutingScores = { incident_diagnosis: 1, routine_topology: 1, advisory: 1 };
        const r = route(label, scores, config);
        expect(r.type).toBe('llm_agent');
      });
    }
  }
});

describe('DEFAULT_ROUTER_CONFIG', () => {
  it('uses 0.5 as the default gate', () => {
    expect(DEFAULT_ROUTER_CONFIG.confidenceGate).toBe(0.5);
  });

  it('uses 50_000 as the default token budget', () => {
    expect(DEFAULT_ROUTER_CONFIG.maxTokenBudget).toBe(50_000);
  });
});
