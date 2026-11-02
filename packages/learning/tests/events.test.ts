/**
 * T0.3 — `groupIntoEvents` y `temporalSplit` según la decisión D9.
 *
 * D9, textual: *Train = antes de `T`, eval = después de `T`. Dentro de cada
 * lado, los incidentes que comparten ancestro en `TopologyEdge` (vigente en
 * `observedAt`) en una ventana de 2 h se agrupan como un evento y nunca
 * quedan partidos entre train y eval. Nunca split aleatorio.*
 */
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_EVENT_WINDOW_MS,
  groupIntoEvents,
  temporalSplit,
} from '../src/events';
import { LearningInputError } from '../src/errors';
import type { LearningIncident, LearningTopologyEdge } from '../src/types';

const HOUR = 60 * 60 * 1000;

function incident(overrides: Partial<LearningIncident> = {}): LearningIncident {
  return {
    tenantId: 'tenant-1',
    incidentId: 'i_1',
    nodeKind: 'onu',
    nodeId: 'onu-1',
    observedAt: '2026-10-01T10:00:00.000Z',
    ...overrides,
  };
}

/** Arista vigente desde siempre y sin fin. */
function edge(
  parentKind: string,
  parentId: string,
  childKind: string,
  childId: string,
): LearningTopologyEdge {
  return {
    tenantId: 'tenant-1',
    parentKind,
    parentId,
    childKind,
    childId,
    validFrom: '2020-01-01T00:00:00.000Z',
    validTo: null,
  };
}

describe('groupIntoEvents — ancestro topológico compartido', () => {
  it('dos incidentes del mismo nodo dentro de la ventana son un evento', () => {
    const events = groupIntoEvents(
      [
        incident({ incidentId: 'i_1', observedAt: '2026-10-01T10:00:00.000Z' }),
        incident({ incidentId: 'i_2', observedAt: '2026-10-01T11:00:00.000Z' }),
      ],
      [],
      DEFAULT_EVENT_WINDOW_MS,
    );

    expect(events).toHaveLength(1);
    expect(events[0]?.incidentIds).toEqual(['i_1', 'i_2']);
  });

  it('dos ONUs del mismo splitter dentro de la ventana son un evento', () => {
    const events = groupIntoEvents(
      [
        incident({ incidentId: 'i_1', nodeId: 'onu-1' }),
        incident({ incidentId: 'i_2', nodeId: 'onu-2', observedAt: '2026-10-01T11:00:00.000Z' }),
      ],
      [edge('splitter', 'sp-1', 'onu', 'onu-1'), edge('splitter', 'sp-1', 'onu', 'onu-2')],
      DEFAULT_EVENT_WINDOW_MS,
    );

    expect(events).toHaveLength(1);
    expect(events[0]?.incidentIds).toEqual(['i_1', 'i_2']);
  });

  it('el ancestro se hereda: dos ONUs bajo el mismo rack comparten splitter', () => {
    const events = groupIntoEvents(
      [
        incident({ incidentId: 'i_1', nodeId: 'onu-1' }),
        incident({ incidentId: 'i_2', nodeId: 'onu-2', observedAt: '2026-10-01T11:00:00.000Z' }),
      ],
      [
        edge('splitter', 'sp-1', 'onu', 'onu-1'),
        edge('splitter', 'sp-1', 'onu', 'onu-2'),
        edge('rack', 'rk-1', 'splitter', 'sp-1'),
      ],
      DEFAULT_EVENT_WINDOW_MS,
    );

    expect(events).toHaveLength(1);
  });

  it('dos ONUs de splitters distintos son eventos distintos', () => {
    const events = groupIntoEvents(
      [
        incident({ incidentId: 'i_1', nodeId: 'onu-1' }),
        incident({ incidentId: 'i_2', nodeId: 'onu-2', observedAt: '2026-10-01T11:00:00.000Z' }),
      ],
      [edge('splitter', 'sp-1', 'onu', 'onu-1'), edge('splitter', 'sp-2', 'onu', 'onu-2')],
      DEFAULT_EVENT_WINDOW_MS,
    );

    expect(events).toHaveLength(2);
  });

  it('una arista vencida no correlelaciona: la topología es temporal', () => {
    const events = groupIntoEvents(
      [
        incident({ incidentId: 'i_1', nodeId: 'onu-1', observedAt: '2026-10-01T10:00:00.000Z' }),
        incident({ incidentId: 'i_2', nodeId: 'onu-2', observedAt: '2026-10-01T11:00:00.000Z' }),
      ],
      [
        {
          tenantId: 'tenant-1',
          parentKind: 'splitter',
          parentId: 'sp-1',
          childKind: 'onu',
          childId: 'onu-1',
          validFrom: '2020-01-01T00:00:00.000Z',
          validTo: '2026-09-01T00:00:00.000Z',
        },
        edge('splitter', 'sp-1', 'onu', 'onu-2'),
      ],
      DEFAULT_EVENT_WINDOW_MS,
    );

    expect(events).toHaveLength(2);
  });

  it('una arista que todavía no empieza no correlelaciona', () => {
    const events = groupIntoEvents(
      [
        incident({ incidentId: 'i_1', nodeId: 'onu-1', observedAt: '2026-10-01T10:00:00.000Z' }),
        incident({ incidentId: 'i_2', nodeId: 'onu-2', observedAt: '2026-10-01T11:00:00.000Z' }),
      ],
      [
        {
          tenantId: 'tenant-1',
          parentKind: 'splitter',
          parentId: 'sp-1',
          childKind: 'onu',
          childId: 'onu-1',
          validFrom: '2026-12-01T00:00:00.000Z',
          validTo: null,
        },
        edge('splitter', 'sp-1', 'onu', 'onu-2'),
      ],
      DEFAULT_EVENT_WINDOW_MS,
    );

    expect(events).toHaveLength(2);
  });
});

describe('groupIntoEvents — ventana temporal', () => {
  it('dos incidentes fuera de la ventana no se agrupan', () => {
    const events = groupIntoEvents(
      [
        incident({ incidentId: 'i_1', observedAt: '2026-10-01T10:00:00.000Z' }),
        incident({
          incidentId: 'i_2',
          observedAt: new Date(Date.parse('2026-10-01T10:00:00.000Z') + 3 * HOUR).toISOString(),
        }),
      ],
      [],
      DEFAULT_EVENT_WINDOW_MS,
    );

    expect(events).toHaveLength(2);
  });

  it('la ventana encadena: si A-B y B-C entran, el evento es uno solo', () => {
    const base = Date.parse('2026-10-01T10:00:00.000Z');
    const events = groupIntoEvents(
      [
        incident({ incidentId: 'i_1', observedAt: new Date(base).toISOString() }),
        incident({ incidentId: 'i_2', observedAt: new Date(base + 1.5 * HOUR).toISOString() }),
        incident({ incidentId: 'i_3', observedAt: new Date(base + 3 * HOUR).toISOString() }),
      ],
      [],
      DEFAULT_EVENT_WINDOW_MS,
    );

    expect(events).toHaveLength(1);
    expect(events[0]?.incidentIds).toEqual(['i_1', 'i_2', 'i_3']);
  });

  it('la ventana por defecto es de 2 horas', () => {
    expect(DEFAULT_EVENT_WINDOW_MS).toBe(2 * HOUR);
  });
});

describe('groupIntoEvents — aislamiento y determinismo', () => {
  it('los incidentes de tenants distintos nunca se agrupan', () => {
    const events = groupIntoEvents(
      [
        incident({ incidentId: 'i_1', tenantId: 'tenant-1' }),
        incident({ incidentId: 'i_2', tenantId: 'tenant-2' }),
      ],
      [],
      DEFAULT_EVENT_WINDOW_MS,
    );

    expect(events).toHaveLength(2);
    expect(events.map((e) => e.tenantId).sort()).toEqual(['tenant-1', 'tenant-2']);
  });

  it('la topología es por tenant: una arista de otro tenant no correlelaciona', () => {
    const events = groupIntoEvents(
      [
        incident({ incidentId: 'i_1', nodeId: 'onu-1', tenantId: 'tenant-1' }),
        incident({
          incidentId: 'i_2',
          nodeId: 'onu-2',
          tenantId: 'tenant-2',
          observedAt: '2026-10-01T11:00:00.000Z',
        }),
      ],
      [
        { ...edge('splitter', 'sp-1', 'onu', 'onu-1'), tenantId: 'tenant-1' },
        { ...edge('splitter', 'sp-1', 'onu', 'onu-2'), tenantId: 'tenant-1' },
      ],
      DEFAULT_EVENT_WINDOW_MS,
    );

    expect(events).toHaveLength(2);
  });

  it('el resultado no depende del orden de entrada', () => {
    const rows = [
      incident({ incidentId: 'i_2', nodeId: 'onu-2', observedAt: '2026-10-01T11:00:00.000Z' }),
      incident({ incidentId: 'i_1', nodeId: 'onu-1' }),
    ];
    const edges = [edge('splitter', 'sp-1', 'onu', 'onu-1'), edge('splitter', 'sp-1', 'onu', 'onu-2')];

    expect(groupIntoEvents(rows, edges, DEFAULT_EVENT_WINDOW_MS)).toEqual(
      groupIntoEvents([...rows].reverse(), edges, DEFAULT_EVENT_WINDOW_MS),
    );
  });

  it('el eventId es determinista y distingue eventos distintos', () => {
    const rows = [
      incident({ incidentId: 'i_1', nodeId: 'onu-1' }),
      incident({ incidentId: 'i_2', nodeId: 'onu-2', observedAt: '2026-10-01T11:00:00.000Z' }),
    ];
    const edges = [edge('splitter', 'sp-1', 'onu', 'onu-1'), edge('splitter', 'sp-1', 'onu', 'onu-2')];

    const primero = groupIntoEvents(rows, edges, DEFAULT_EVENT_WINDOW_MS);
    const segundo = groupIntoEvents(rows, edges, DEFAULT_EVENT_WINDOW_MS);

    expect(primero[0]?.eventId).toBe(segundo[0]?.eventId);

    const otro = groupIntoEvents(
      [incident({ incidentId: 'i_9', nodeId: 'onu-9' })],
      [],
      DEFAULT_EVENT_WINDOW_MS,
    );
    expect(otro[0]?.eventId).not.toBe(primero[0]?.eventId);
  });

  it('sin incidentes devuelve una lista vacía', () => {
    expect(groupIntoEvents([], [], DEFAULT_EVENT_WINDOW_MS)).toEqual([]);
  });

  it('el evento lleva el inicio y el fin de sus incidentes', () => {
    const events = groupIntoEvents(
      [
        incident({ incidentId: 'i_1', observedAt: '2026-10-01T12:00:00.000Z' }),
        incident({ incidentId: 'i_2', observedAt: '2026-10-01T10:00:00.000Z' }),
      ],
      [],
      DEFAULT_EVENT_WINDOW_MS,
    );

    expect(events[0]?.startedAt).toBe('2026-10-01T10:00:00.000Z');
    expect(events[0]?.endedAt).toBe('2026-10-01T12:00:00.000Z');
  });
});

describe('temporalSplit — train antes de T, eval después de T', () => {
  const events = groupIntoEvents(
    [
      incident({ incidentId: 'i_antes', observedAt: '2026-10-01T08:00:00.000Z' }),
      incident({ incidentId: 'i_despues', observedAt: '2026-10-03T08:00:00.000Z' }),
    ],
    [],
    DEFAULT_EVENT_WINDOW_MS,
  );

  it('lo anterior al corte va a train y lo posterior a eval', () => {
    const split = temporalSplit(events, '2026-10-02T00:00:00.000Z');

    expect(split.train.map((e) => e.incidentIds[0])).toEqual(['i_antes']);
    expect(split.eval.map((e) => e.incidentIds[0])).toEqual(['i_despues']);
    expect(split.crossing).toHaveLength(0);
  });

  it('un evento que cruza el corte va a train y queda marcado', () => {
    const cruzando = groupIntoEvents(
      [
        incident({ incidentId: 'i_a', observedAt: '2026-10-01T23:00:00.000Z' }),
        incident({ incidentId: 'i_b', observedAt: '2026-10-02T01:00:00.000Z' }),
      ],
      [],
      DEFAULT_EVENT_WINDOW_MS,
    );

    const split = temporalSplit(cruzando, '2026-10-02T00:00:00.000Z');

    expect(split.train).toHaveLength(1);
    expect(split.eval).toHaveLength(0);
    expect(split.crossing).toHaveLength(1);
  });

  it('eval queda estrictamente después del corte: no entra nada anterior', () => {
    const conAntes = groupIntoEvents(
      [
        incident({ incidentId: 'i_a', observedAt: '2026-09-01T00:00:00.000Z' }),
        incident({ incidentId: 'i_b', observedAt: '2026-10-05T00:00:00.000Z' }),
      ],
      [],
      DEFAULT_EVENT_WINDOW_MS,
    );

    const split = temporalSplit(conAntes, '2026-10-02T00:00:00.000Z');
    const corte = Date.parse('2026-10-02T00:00:00.000Z');

    for (const evento of split.eval) {
      expect(Date.parse(evento.startedAt)).toBeGreaterThan(corte);
    }
  });

  it('ningún incidente queda en los dos lados a la vez', () => {
    const mezclados = groupIntoEvents(
      [
        incident({ incidentId: 'i_a', observedAt: '2026-10-01T08:00:00.000Z' }),
        incident({ incidentId: 'i_b', observedAt: '2026-10-03T08:00:00.000Z' }),
        incident({ incidentId: 'i_c', observedAt: '2026-10-01T23:00:00.000Z' }),
        incident({ incidentId: 'i_d', observedAt: '2026-10-02T01:00:00.000Z' }),
      ],
      [],
      DEFAULT_EVENT_WINDOW_MS,
    );

    const split = temporalSplit(mezclados, '2026-10-02T00:00:00.000Z');
    const enTrain = new Set(split.train.flatMap((e) => e.incidentIds));
    const enEval = new Set(split.eval.flatMap((e) => e.incidentIds));

    for (const id of enTrain) {
      expect(enEval.has(id)).toBe(false);
    }
  });

  it('fuga: dos ONUs del mismo splitter nunca quedan en lados distintos', () => {
    // Las dos ONUs cuelgan del mismo splitter y caen dentro de la ventana:
    // son un evento, así que no pueden separarse entre train y eval.
    const eventos = groupIntoEvents(
      [
        incident({ incidentId: 'i_1', nodeId: 'onu-1', observedAt: '2026-10-01T23:00:00.000Z' }),
        incident({ incidentId: 'i_2', nodeId: 'onu-2', observedAt: '2026-10-02T01:00:00.000Z' }),
      ],
      [edge('splitter', 'sp-1', 'onu', 'onu-1'), edge('splitter', 'sp-1', 'onu', 'onu-2')],
      DEFAULT_EVENT_WINDOW_MS,
    );

    expect(eventos).toHaveLength(1);

    const split = temporalSplit(eventos, '2026-10-02T00:00:00.000Z');
    const ladoDe = (incidentId: string): string => {
      if (split.train.some((e) => e.incidentIds.includes(incidentId))) return 'train';
      if (split.eval.some((e) => e.incidentIds.includes(incidentId))) return 'eval';
      return 'ninguno';
    };

    expect(ladoDe('i_1')).toBe(ladoDe('i_2'));
    expect(ladoDe('i_1')).not.toBe('ninguno');
  });

  it('el reparto es determinista y conserva el orden de los eventos', () => {
    const varios = groupIntoEvents(
      [
        incident({ incidentId: 'i_1', observedAt: '2026-10-01T08:00:00.000Z' }),
        incident({ incidentId: 'i_2', observedAt: '2026-10-03T08:00:00.000Z' }),
      ],
      [],
      DEFAULT_EVENT_WINDOW_MS,
    );

    expect(temporalSplit(varios, '2026-10-02T00:00:00.000Z')).toEqual(
      temporalSplit(varios, '2026-10-02T00:00:00.000Z'),
    );
  });

  it('sin eventos devuelve un reparto vacío', () => {
    const split = temporalSplit([], '2026-10-02T00:00:00.000Z');

    expect(split.train).toEqual([]);
    expect(split.eval).toEqual([]);
    expect(split.crossing).toEqual([]);
  });
});

describe('entradas inválidas', () => {
  it('un incidente roto se rechaza en vez de descartarse en silencio', () => {
    expect(() =>
      groupIntoEvents([incident({ incidentId: '' })], [], DEFAULT_EVENT_WINDOW_MS),
    ).toThrow(LearningInputError);
  });

  it('una fecha de observación ilegible se rechaza', () => {
    expect(() =>
      groupIntoEvents([incident({ observedAt: 'ayer' })], [], DEFAULT_EVENT_WINDOW_MS),
    ).toThrow(LearningInputError);
  });

  it('una ventana negativa se rechaza', () => {
    expect(() => groupIntoEvents([incident()], [], -1)).toThrow(LearningInputError);
  });

  it('un corte ilegible se rechaza', () => {
    expect(() => temporalSplit([], 'ayer')).toThrow(LearningInputError);
  });
});
