/**
 * Adaptive Router — Slice 1 tests.
 *
 * Pure-function tests for `extractSignals`, `selectMode`, `selectTools`,
 * and `planRoute`. No runtime, no LLM, no I/O.
 */

import { describe, expect, it } from 'vitest';
import {
  extractSignals,
  planRoute,
  selectMode,
  selectTools,
  type QuerySignals,
} from '../src/adaptive-router';
import type { IntentionLabel } from '../src/diagnostic-router';

// ── extractSignals ─────────────────────────────────────────────────────────

describe('extractSignals', () => {
  it('detects an ONU device ID', () => {
    const s = extractSignals('estado de ONU-342');
    expect(s.deviceIds).toContain('ONU-342');
    expect(s.deviceCount).toBe(1);
    expect(s.actionWord).toBe('status');
  });

  it('detects an OLT device ID', () => {
    const s = extractSignals('listar puertos de OLT-Core-01');
    expect(s.deviceIds).toContain('OLT-CORE-01');
    expect(s.actionWord).toBe('list');
  });

  it('detects multi-device hint via "varias"', () => {
    const s = extractSignals('hay varias ONUs caídas en OLT-01');
    expect(s.multiDevice).toBe(true);
  });

  it('detects cause-analysis hint', () => {
    const s = extractSignals('cuál es la causa raíz de la caída?');
    expect(s.causeAnalysis).toBe(true);
  });

  it('detects historical hint', () => {
    const s = extractSignals('qué pasó ayer con ONU-342');
    expect(s.historical).toBe(true);
  });

  it('detects question marks', () => {
    expect(extractSignals('¿estado?').hasQuestionMark).toBe(true);
    expect(extractSignals('estado').hasQuestionMark).toBe(false);
  });

  it('detects action word: list/detail/status/power/history', () => {
    expect(extractSignals('listame las onus').actionWord).toBe('list');
    expect(extractSignals('detalle de OLT-01').actionWord).toBe('detail');
    expect(extractSignals('estado de ONU-342').actionWord).toBe('status');
    expect(extractSignals('potencia RX de ONU-342').actionWord).toBe('power');
    expect(extractSignals('qué pasó con ONU-342 ayer').actionWord).toBe('history');
  });

  it('returns actionWord=null when no action word matches', () => {
    const s = extractSignals('la onu-342 tiene inconvenientes');
    expect(s.actionWord).toBe(null);
  });

  it('detects device IDs and extracts signals', () => {
    const s = extractSignals('¿Cuál es la POTENCIA de la ONU-342?');
    expect(s.deviceIds).toContain('ONU-342');
    expect(s.actionWord).toBe('power');
  });
});

// ── selectMode ─────────────────────────────────────────────────────────────

describe('selectMode', () => {
  describe('hard rules', () => {
    it('advisory always routes to investigation', () => {
      const signals = emptySignals();
      expect(selectMode('advisory', signals)).toBe('investigation');
    });

    it('multi-device hint forces investigation', () => {
      const signals = { ...emptySignals(), multiDevice: true };
      expect(selectMode('routine_topology', signals)).toBe('investigation');
    });

    it('cause-analysis hint forces investigation', () => {
      const signals = { ...emptySignals(), causeAnalysis: true };
      expect(selectMode('routine_topology', signals)).toBe('investigation');
    });
  });

  describe('routine_topology', () => {
    it('single device, no question, no history → direct', () => {
      const s = { ...emptySignals(), deviceCount: 1, hasQuestionMark: false, historical: false };
      expect(selectMode('routine_topology', s)).toBe('direct');
    });

    it('single device + question → assisted (LLM frames)', () => {
      const s = { ...emptySignals(), deviceCount: 1, hasQuestionMark: true };
      expect(selectMode('routine_topology', s)).toBe('assisted');
    });

    it('historical keyword → assisted (retrieval needed)', () => {
      const s = { ...emptySignals(), deviceCount: 1, historical: true };
      expect(selectMode('routine_topology', s)).toBe('assisted');
    });

    it('no device + question → assisted', () => {
      const s = { ...emptySignals(), deviceCount: 0, hasQuestionMark: true };
      expect(selectMode('routine_topology', s)).toBe('assisted');
    });
  });

  describe('incident_diagnosis', () => {
    it('single device, no question → direct', () => {
      const s = { ...emptySignals(), deviceCount: 1, hasQuestionMark: false };
      expect(selectMode('incident_diagnosis', s)).toBe('direct');
    });

    it('single device + question → assisted', () => {
      const s = { ...emptySignals(), deviceCount: 1, hasQuestionMark: true };
      expect(selectMode('incident_diagnosis', s)).toBe('assisted');
    });

    it('no device id → assisted (LLM picks the right tool)', () => {
      const s = { ...emptySignals(), deviceCount: 0, hasQuestionMark: true };
      expect(selectMode('incident_diagnosis', s)).toBe('assisted');
    });
  });
});

// ── selectTools ────────────────────────────────────────────────────────────

describe('selectTools', () => {
  const ALL = [
    'get_predicted_issues', 'list_olts', 'get_olt_detail', 'get_network_overview',
    'list_onus', 'get_onu_detail', 'get_onus_with_low_signal',
    'search_by_customer_name', 'get_topology_path', 'get_downstream_clients',
  ];

  it('investigation mode returns all tools', () => {
    const signals = emptySignals();
    const t = selectTools('investigation', signals, ALL);
    expect(t).toHaveLength(ALL.length);
    expect(new Set(t)).toEqual(new Set(ALL));
  });

  it('direct mode returns exactly 1 tool', () => {
    const signals = { ...emptySignals(), deviceIds: ['ONU-342'], deviceCount: 1, actionWord: 'status' as const };
    const t = selectTools('direct', signals, ALL);
    expect(t).toHaveLength(1);
    // When a device ID is provided, the device-kind-specific tool wins over
    // the action-word tool. This is intentional — "estado de ONU-342" wants
    // get_onu_detail (the device-specific read), not list_onus (a general list).
    expect(t[0]).toBe('get_onu_detail');
  });

  it('assisted mode returns query tool + 1 context tool', () => {
    const signals = { ...emptySignals(), deviceIds: ['ONU-342'], deviceCount: 1, actionWord: 'history' as const };
    const t = selectTools('assisted', signals, ALL);
    expect(t.length).toBeGreaterThanOrEqual(2);
    expect(t).toContain('get_predicted_issues');
    expect(t.length).toBeLessThanOrEqual(4);
  });

  it('direct mode for OLT picks get_olt_detail', () => {
    const signals = { ...emptySignals(), deviceIds: ['OLT-001'], deviceCount: 1, actionWord: 'detail' as const };
    const t = selectTools('direct', signals, ALL);
    // Device-kind wins over action-word because the device ID is more specific.
    expect(t[0]).toBe('get_olt_detail');
  });

  it('power action word picks get_onus_with_low_signal first', () => {
    const signals = { ...emptySignals(), actionWord: 'power' as const };
    const t = selectTools('direct', signals, ALL);
    expect(t).toContain('get_onus_with_low_signal');
  });

  it('falls back to get_network_overview when nothing matches', () => {
    const signals = emptySignals();
    const t = selectTools('direct', signals, ALL);
    expect(t).toEqual(['get_network_overview']);
  });
});

// ── planRoute (end-to-end) ────────────────────────────────────────────────

describe('planRoute', () => {
  it('"estado de ONU-342" plans direct mode with one tool', () => {
    const route = planRoute({ userMessage: 'estado de ONU-342' });
    expect(route.mode).toBe('direct');
    expect(route.tools).toHaveLength(1);
    expect(route.maxIterations).toBe(0);
  });

  it('"potencia RX de ONU-342" plans direct mode with power tool', () => {
    const route = planRoute({ userMessage: 'potencia RX de ONU-342' });
    expect(route.mode).toBe('direct');
    // Device-kind-specific tool wins over action-word tool. For an ONU with
    // a power query, get_onu_detail is the answer tool (one round-trip
    // returns the power value).
    expect(route.tools[0]).toBe('get_onu_detail');
  });

  it('"qué pasó ayer con ONU-342" plans assisted mode', () => {
    const route = planRoute({ userMessage: 'qué pasó ayer con ONU-342' });
    expect(route.mode).toBe('assisted');
    expect(route.maxIterations).toBe(1);
  });

  it('"caída progresiva de RX en 28 ONUs, causa raíz" plans investigation', () => {
    const route = planRoute({
      userMessage: 'caída progresiva de RX en 28 ONUs, cuál es la causa raíz?',
    });
    expect(route.mode).toBe('investigation');
    expect(route.maxIterations).toBe(6);
  });

  it('"como funciona el algoritmo de DBA en GPON" plans investigation (advisory)', () => {
    const route = planRoute({ userMessage: 'cómo funciona el algoritmo de DBA en GPON' });
    expect(route.mode).toBe('investigation');
  });

  it('maxIterations is 0 for direct, 1 for assisted, 6 for investigation', () => {
    expect(planRoute({ userMessage: 'estado ONU-342' }).maxIterations).toBe(0);
    expect(planRoute({ userMessage: 'qué pasó con ONU-342 ayer' }).maxIterations).toBe(1);
    expect(planRoute({ userMessage: 'cuál es la causa raíz de las 28 ONUs caídas?' }).maxIterations).toBe(6);
  });

  it('reason field is human-readable', () => {
    const route = planRoute({ userMessage: 'estado ONU-342' });
    expect(route.reason).toContain('direct');
    expect(route.reason).toMatch(/routine_topology|incident_diagnosis/);
  });

  it('label reflects the classifier output', () => {
    const a = planRoute({ userMessage: 'estado ONU-342' });
    const b = planRoute({ userMessage: 'qué pasó ayer con ONU-342' });
    // "estado de ONU-342" without urgency markers classifies as routine_topology.
    // "qué pasó ayer con ONU-342" also classifies as routine_topology (history keyword).
    expect(a.label).toBe('routine_topology');
    expect(b.label).toBe('routine_topology');
  });
});

// ── Helpers ────────────────────────────────────────────────────────────────

function emptySignals(): QuerySignals {
  return {
    normalized: '',
    deviceIds: [],
    hasQuestionMark: false,
    deviceCount: 0,
    multiDevice: false,
    causeAnalysis: false,
    historical: false,
    actionWord: null,
  };
}
