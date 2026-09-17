/**
 * Block 2 (diagnostic-router) — intention classifier unit tests.
 */

import { describe, expect, it } from 'vitest';
import {
  classifyIntention,
  matchKeywords,
  normalizeText,
  scoreFromMatches,
  selectLabel,
  type IntentionContext,
} from '../src/intention-classifier';
import type { IntentionLabel } from '../src/intention-schema';

describe('normalizeText', () => {
  it('lowercases and strips accents', () => {
    expect(normalizeText('LOi Árbol')).toBe('loi arbol');
  });

  it('collapses whitespace', () => {
    expect(normalizeText('  sin   servicio  ')).toBe('sin servicio');
  });

  it('strips Spanish punctuation', () => {
    expect(normalizeText('¿Cómo funciona?')).toBe('como funciona');
  });
});

describe('matchKeywords', () => {
  it('matches incident_diagnosis keywords', () => {
    const m = matchKeywords('La ONU está en LOi sin servicio urgente');
    expect(m.incident_diagnosis).toContain('loi');
    expect(m.incident_diagnosis).toContain('sin servicio');
    expect(m.incident_diagnosis).toContain('urgente');
  });

  it('matches routine_topology keywords', () => {
    const m = matchKeywords('Mostrame el árbol de puertos del OLT');
    expect(m.routine_topology).toContain('mostrame');
    expect(m.routine_topology).toContain('arbol');
    expect(m.routine_topology).toContain('puertos');
  });

  it('matches advisory keywords', () => {
    const m = matchKeywords('Cómo funciona el algoritmo?');
    expect(m.advisory).toContain('como');
    expect(m.advisory).toContain('funciona');
    expect(m.advisory).toContain('algoritmo');
  });

  it('returns empty matches for unrecognised text', () => {
    const m = matchKeywords('lorem ipsum dolor sit amet');
    expect(m.incident_diagnosis).toHaveLength(0);
    expect(m.routine_topology).toHaveLength(0);
    expect(m.advisory).toHaveLength(0);
  });
});

describe('scoreFromMatches', () => {
  it('produces 0..1 scores proportional to matches', () => {
    const s = scoreFromMatches({
      incident_diagnosis: ['loi', 'sin servicio', 'urgente'],
      routine_topology: [],
      advisory: [],
    });
    expect(s.incident_diagnosis).toBeGreaterThan(0);
    expect(s.incident_diagnosis).toBeLessThanOrEqual(1);
    expect(s.routine_topology).toBe(0);
    expect(s.advisory).toBe(0);
  });

  it('caps scores at 1', () => {
    const huge = Array(100).fill('loi');
    const s = scoreFromMatches({
      incident_diagnosis: huge,
      routine_topology: [],
      advisory: [],
    });
    expect(s.incident_diagnosis).toBe(1);
  });
});

describe('selectLabel', () => {
  it('returns the highest-scoring label', () => {
    expect(selectLabel({ incident_diagnosis: 0.1, routine_topology: 0.5, advisory: 0.2 })).toBe('routine_topology');
  });

  it('breaks ties via TIE_BREAK_ORDER (incident_diagnosis wins)', () => {
    expect(selectLabel({ incident_diagnosis: 0.3, routine_topology: 0.3, advisory: 0.3 })).toBe('incident_diagnosis');
  });

  it('breaks ties preferring routine_topology over advisory', () => {
    expect(selectLabel({ incident_diagnosis: 0, routine_topology: 0.3, advisory: 0.3 })).toBe('routine_topology');
  });

  it('returns advisory as fallback for zero scores', () => {
    expect(selectLabel({ incident_diagnosis: 0, routine_topology: 0, advisory: 0 })).toBe('advisory');
  });
});

describe('classifyIntention (end-to-end)', () => {
  const cases: Array<{ msg: string; expected: IntentionLabel }> = [
    { msg: 'La ONU del cliente Juan está en LOi hace 3 horas', expected: 'incident_diagnosis' },
    { msg: 'Corte masivo en OLT-Core-01, todos los clientes sin servicio', expected: 'incident_diagnosis' },
    { msg: 'Power outage general, clientes sin servicio urgente', expected: 'incident_diagnosis' },
    { msg: 'Mostrame el árbol de red del OLT', expected: 'routine_topology' },
    { msg: 'Cuántas ONUs activas hay en el OLT-Sur', expected: 'routine_topology' },
    { msg: 'A qué puerto está conectada la ONU 00:25', expected: 'routine_topology' },
    { msg: 'Cómo funciona el algoritmo de DBA en GPON', expected: 'advisory' },
    { msg: 'Cuál es la mejor práctica para configurar SNMP v3', expected: 'advisory' },
    { msg: 'Qué significa el FEC corrected counter', expected: 'advisory' },
  ];

  for (const { msg, expected } of cases) {
    it(`classifies "${msg}" as ${expected}`, () => {
      const ctx: IntentionContext = { surface: 'user-message', userMessage: msg };
      const { label } = classifyIntention(ctx);
      expect(label).toBe(expected);
    });
  }
});
