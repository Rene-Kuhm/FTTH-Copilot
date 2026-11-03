import { describe, expect, it } from 'vitest';

/**
 * T1.6 — el corpus de abstención de I7 y su línea base.
 *
 * I7: en el corpus de casos sin datos suficientes, la tasa de abstención con
 * aprendizaje activo es ≥ la tasa sin aprendizaje.
 *
 * El corpus fija los casos (sin datos + historia muy parecida en la KB) y la
 * línea base contra la que se mide cuando el learning loop se prenda.
 */
import { computeGateDecision } from '../src/runner';
import {
  ABSTENTION_BASELINE_RATE,
  ABSTENTION_CORPUS,
  ABSTENTION_CORPUS_FLOOR,
  ABSTENTION_CORPUS_SCHEMA,
  assertAbstentionCorpusFloor,
  computeCorpusAbstentionRate,
  loadAbstentionCorpus,
} from '../src/abstention-corpus';

describe('el corpus de abstención (T1.6)', () => {
  it('declara su versión de contrato', () => {
    expect(ABSTENTION_CORPUS_SCHEMA).toBe('ftth.eval-abstention-corpus.v1');
  });

  it('cumple el mínimo del corpus', () => {
    expect(() => assertAbstentionCorpusFloor()).not.toThrow();
    expect(ABSTENTION_CORPUS.cases.length).toBeGreaterThanOrEqual(
      ABSTENTION_CORPUS_FLOOR.cases,
    );
  });

  it('cada caso tiene al menos un incidente histórico muy parecido', () => {
    for (const c of ABSTENTION_CORPUS.cases) {
      expect(c.kbNeighbors.length).toBeGreaterThanOrEqual(
        ABSTENTION_CORPUS_FLOOR.neighborsPerCase,
      );
      for (const neighbor of c.kbNeighbors) {
        expect(neighbor.similarity).toBe('high');
      }
    }
  });

  it('cada caso espera abstención', () => {
    for (const c of ABSTENTION_CORPUS.cases) {
      expect(c.expectedGate).toBe('abstain');
    }
  });

  it('la carga devuelve una copia defensiva', () => {
    const corpus = loadAbstentionCorpus();
    expect(corpus.cases).not.toBe(ABSTENTION_CORPUS.cases);
    expect(corpus.cases.length).toBe(ABSTENTION_CORPUS.cases.length);
  });
});

describe('la línea base de abstención (T1.6)', () => {
  it('sin aprendizaje, el corpus abstiene en todos los casos', () => {
    const rate = computeCorpusAbstentionRate(ABSTENTION_CORPUS.cases, (c) =>
      computeGateDecision(c.verdicts, 'strict'),
    );
    expect(rate).toBe(1.0);
  });

  it('la línea base registrada es la que el corpus mide', () => {
    const rate = computeCorpusAbstentionRate(ABSTENTION_CORPUS.cases, (c) =>
      computeGateDecision(c.verdicts, 'strict'),
    );
    expect(rate).toBe(ABSTENTION_BASELINE_RATE);
  });

  it('un corpus vacío no inventa una tasa de cero', () => {
    expect(computeCorpusAbstentionRate([], () => 'allow')).toBe(1.0);
  });

  it('I7: la tasa medida con aprendizaje tiene que ser ≥ la línea base', () => {
    // La condición que la Fase 2 y la Fase 5 van a medir de verdad. Acá se
    // verifica que el contrato está escrito y que la línea base es la que
    // corresponde.
    const baseline = ABSTENTION_BASELINE_RATE;
    const rate = computeCorpusAbstentionRate(ABSTENTION_CORPUS.cases, (c) =>
      computeGateDecision(c.verdicts, 'strict'),
    );
    expect(rate).toBeGreaterThanOrEqual(baseline);
  });
});
