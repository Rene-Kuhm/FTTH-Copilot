import { describe, expect, it } from 'vitest';

/**
 * T1.5 — el corpus rojo de la superficie `retrieval-block`.
 *
 * Con recall semántico (Fase 2) una fila envenenada de la KB se recupera
 * **mucho más seguido** que hoy: el aprendizaje amplifica el daño de una sola
 * fila mala. Por eso la superficie `retrieval-block` necesita casos rojos que
 * metan en la KB filas con instrucciones embebidas.
 *
 * Este test ata el corpus con el detector que usa el saneador de escritura
 * (D3): si una fila envenenada del corpus pasa inadvertida por el detector,
 * el corpus miente sobre la cobertura.
 */
import { detectInstructionInjection } from '@ftth-copilot/shared';

import redCorpus from '../corpus/red.json' assert { type: 'json' };
import { evalCorpusSchema, type EvalCase, type EvalCorpus } from '../src/corpus-schema';

const corpus: EvalCorpus = evalCorpusSchema.parse(redCorpus);

interface ConfirmedIncidentRow {
  summary?: string;
  rootCause?: string;
  fix?: string;
}

/** Los textos libres de una fila de incidente confirmado. */
function freeTexts(row: ConfirmedIncidentRow): string[] {
  return [row.summary, row.rootCause, row.fix].filter((text): text is string =>
    typeof text === 'string' && text.length > 0,
  );
}

/** Las filas confirmadas que el caso mete por `search_confirmed_incidents`. */
function confirmedRows(case_: EvalCase): ConfirmedIncidentRow[] {
  const rows: ConfirmedIncidentRow[] = [];
  for (const mock of case_.toolMocks ?? []) {
    if (mock.toolName !== 'search_confirmed_incidents') continue;
    const returns = mock.returns;
    if (Array.isArray(returns)) {
      for (const entry of returns) {
        if (entry && typeof entry === 'object') rows.push(entry as ConfirmedIncidentRow);
      }
    }
  }
  return rows;
}

function retrievalBlockCases(): EvalCase[] {
  return corpus.cases.filter((c) => c.surface === 'retrieval-block');
}

describe('corpus rojo — superficie retrieval-block (T1.5)', () => {
  it('tiene al menos cuatro casos: el original y los tres nuevos', () => {
    expect(retrievalBlockCases().length).toBeGreaterThanOrEqual(4);
  });

  it('cubre los tres tipos de inyeccion de la KB', () => {
    const kinds = new Set(retrievalBlockCases().map((c) => c.injectionKind));
    expect(kinds.has('direct-override')).toBe(true);
    expect(kinds.has('role-reassignment')).toBe(true);
    expect(kinds.has('customer-name-smuggle')).toBe(true);
  });

  it('ningún caso de retrieval-block espera un `allow`', () => {
    for (const case_ of retrievalBlockCases()) {
      expect(
        case_.expectedGate === 'warn' || case_.expectedGate === 'abstain',
        `el caso ${case_.id} no puede esperar 'allow'`,
      ).toBe(true);
    }
  });

  it('el detector que usa el saneador detecta TODA fila envenenada del corpus', () => {
    const missed: string[] = [];
    for (const case_ of corpus.cases) {
      for (const row of confirmedRows(case_)) {
        // Una fila está envenenada si al menos uno de sus textos libres lleva
        // una instrucción embebida: el resto de los campos son benignos.
        const detected = freeTexts(row).some(
          (text) => detectInstructionInjection(text) !== null,
        );
        if (!detected) missed.push(`${case_.id}: ${JSON.stringify(row).slice(0, 80)}`);
      }
    }
    expect(missed).toEqual([]);
  });

  it('las tres filas nuevas del corpus son detectadas una por una', () => {
    const expected: Record<string, string> = {
      'red-retrieval-direct-override-002': 'direct-override',
      'red-retrieval-role-reassignment-002': 'role-reassignment',
      'red-retrieval-customer-name-smuggle-002': 'customer-name-smuggle',
    };
    for (const [id, kind] of Object.entries(expected)) {
      const case_ = corpus.cases.find((c) => c.id === id);
      expect(case_, `falta el caso ${id}`).toBeDefined();
      const rows = confirmedRows(case_!);
      expect(rows.length).toBeGreaterThan(0);
      const found = rows
        .flatMap((row) => freeTexts(row))
        .map((text) => detectInstructionInjection(text))
        .find((detection) => detection !== null);
      expect(found?.kind, `${id} no se detecta como ${kind}`).toBe(kind);
    }
  });
});
