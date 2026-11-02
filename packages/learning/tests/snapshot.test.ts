/**
 * T0.5 — El snapshot del learning loop.
 *
 * El job `learning.snapshot` congela el dataset de un tenant: mismo
 * contenido, misma ventana y misma versión de código ⇒ **mismo hash**. Es
 * lo que hace que una evaluación posterior sea reproducible: si el dataset
 * cambió, el hash cambia, y se sabe.
 */
import { describe, expect, it } from 'vitest';

import { buildLearningSnapshot } from '../src/snapshot';
import type {
  LearningFeedbackRow,
  LearningIncident,
  LearningTopologyEdge,
} from '../src/types';

function feedback(overrides: Partial<LearningFeedbackRow> = {}): LearningFeedbackRow {
  return {
    tenantId: 'tenant-1',
    versionId: 'v_1',
    feedbackId: 'f_1',
    authorUserId: 'u_1',
    label: 'confirmed',
    submittedAt: '2026-10-01T10:00:00.000Z',
    ...overrides,
  };
}

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

const edge: LearningTopologyEdge = {
  tenantId: 'tenant-1',
  parentKind: 'splitter',
  parentId: 'sp-1',
  childKind: 'onu',
  childId: 'onu-1',
  validFrom: '2020-01-01T00:00:00.000Z',
  validTo: null,
};

const base = {
  tenantId: 'tenant-1',
  windowStart: '2026-10-01T00:00:00.000Z',
  windowEnd: '2026-10-08T00:00:00.000Z',
  codeVersion: '0.2.2',
  cutoff: '2026-10-04T00:00:00.000Z',
};

describe('buildLearningSnapshot — el hash congela el dataset', () => {
  it('dos corridas sobre los mismos datos dan el mismo hash', () => {
    const input = {
      ...base,
      feedbackRows: [feedback()],
      incidents: [incident()],
      topology: [edge],
    };

    expect(buildLearningSnapshot(input).snapshotHash).toBe(
      buildLearningSnapshot(input).snapshotHash,
    );
  });

  it('el hash no depende del orden de las filas', () => {
    const feedbackRows = [
      feedback({ versionId: 'v_2', feedbackId: 'f_2' }),
      feedback({ versionId: 'v_1', feedbackId: 'f_1' }),
    ];
    const incidents = [
      incident({ incidentId: 'i_2', nodeId: 'onu-2', observedAt: '2026-10-01T11:00:00.000Z' }),
      incident({ incidentId: 'i_1', nodeId: 'onu-1' }),
    ];

    const primero = buildLearningSnapshot({ ...base, feedbackRows, incidents, topology: [edge] });
    const segundo = buildLearningSnapshot({
      ...base,
      feedbackRows: [...feedbackRows].reverse(),
      incidents: [...incidents].reverse(),
      topology: [edge],
    });

    expect(primero.snapshotHash).toBe(segundo.snapshotHash);
  });

  it('cambia el contenido cambia el hash', () => {
    const conEvento = buildLearningSnapshot({
      ...base,
      feedbackRows: [feedback()],
      incidents: [incident()],
      topology: [edge],
    });
    const conOtroEvento = buildLearningSnapshot({
      ...base,
      feedbackRows: [feedback()],
      incidents: [incident({ incidentId: 'i_2' })],
      topology: [edge],
    });

    expect(conEvento.snapshotHash).not.toBe(conOtroEvento.snapshotHash);
  });

  it('cambia la versión de código cambia el hash', () => {
    const v1 = buildLearningSnapshot({
      ...base,
      feedbackRows: [feedback()],
      incidents: [incident()],
      topology: [edge],
    });
    const v2 = buildLearningSnapshot({
      ...base,
      codeVersion: '0.3.0',
      feedbackRows: [feedback()],
      incidents: [incident()],
      topology: [edge],
    });

    expect(v1.snapshotHash).not.toBe(v2.snapshotHash);
  });

  it('cambia la ventana cambia el hash', () => {
    const ventanaA = buildLearningSnapshot({
      ...base,
      feedbackRows: [feedback()],
      incidents: [incident()],
      topology: [edge],
    });
    const ventanaB = buildLearningSnapshot({
      ...base,
      windowEnd: '2026-10-15T00:00:00.000Z',
      feedbackRows: [feedback()],
      incidents: [incident()],
      topology: [edge],
    });

    expect(ventanaA.snapshotHash).not.toBe(ventanaB.snapshotHash);
  });

  it('cambia el corte temporal cambia el hash', () => {
    const corteA = buildLearningSnapshot({
      ...base,
      feedbackRows: [feedback()],
      incidents: [incident()],
      topology: [edge],
    });
    const corteB = buildLearningSnapshot({
      ...base,
      cutoff: '2026-10-05T00:00:00.000Z',
      feedbackRows: [feedback()],
      incidents: [incident()],
      topology: [edge],
    });

    expect(corteA.snapshotHash).not.toBe(corteB.snapshotHash);
  });
});

describe('buildLearningSnapshot — el snapshot trae el dataset congelado', () => {
  it('expone la ventana, la versión de código y el corte', () => {
    const snapshot = buildLearningSnapshot({
      ...base,
      feedbackRows: [],
      incidents: [],
      topology: [],
    });

    expect(snapshot.tenantId).toBe('tenant-1');
    expect(snapshot.windowStart).toBe(base.windowStart);
    expect(snapshot.windowEnd).toBe(base.windowEnd);
    expect(snapshot.codeVersion).toBe(base.codeVersion);
    expect(snapshot.cutoff).toBe(base.cutoff);
    expect(snapshot.snapshotHash).toMatch(/^s_[0-9a-f]{16}$/);
  });

  it('trae las etiquetas resueltas y los eventos agrupados', () => {
    const snapshot = buildLearningSnapshot({
      ...base,
      feedbackRows: [
        feedback({ label: 'confirmed' }),
        feedback({
          feedbackId: 'f_2',
          versionId: 'v_2',
          authorUserId: 'u_2',
          label: 'incorrect',
          submittedAt: '2026-10-01T11:00:00.000Z',
        }),
      ],
      incidents: [incident()],
      topology: [edge],
    });

    expect(snapshot.labels.entries).toHaveLength(2);
    expect(snapshot.counts.confirmed).toBe(1);
    expect(snapshot.counts.incorrect).toBe(1);
    expect(snapshot.events).toHaveLength(1);
  });

  it('trae el split temporal: train antes del corte, eval después', () => {
    const snapshot = buildLearningSnapshot({
      ...base,
      feedbackRows: [],
      incidents: [
        incident({ incidentId: 'i_antes', observedAt: '2026-10-02T08:00:00.000Z' }),
        incident({ incidentId: 'i_despues', observedAt: '2026-10-06T08:00:00.000Z' }),
      ],
      topology: [],
    });

    expect(snapshot.split.train.map((e) => e.incidentIds[0])).toEqual(['i_antes']);
    expect(snapshot.split.eval.map((e) => e.incidentIds[0])).toEqual(['i_despues']);
    expect(snapshot.counts.train).toBe(1);
    expect(snapshot.counts.eval).toBe(1);
  });

  it('cuenta las filas descartadas sin esconderlas', () => {
    const snapshot = buildLearningSnapshot({
      ...base,
      feedbackRows: [feedback({ label: 'quiza_mal' }), feedback({ feedbackId: 'f_2' })],
      incidents: [],
      topology: [],
    });

    expect(snapshot.counts.discarded).toBe(1);
    expect(snapshot.counts.labelled).toBe(1);
  });

  it('no mezcla tenants: el snapshot es de un solo tenant', () => {
    const snapshot = buildLearningSnapshot({
      ...base,
      feedbackRows: [
        feedback({ tenantId: 'tenant-1' }),
        feedback({ tenantId: 'tenant-2', feedbackId: 'f_2' }),
      ],
      incidents: [incident({ tenantId: 'tenant-1' })],
      topology: [edge],
    });

    expect(snapshot.labels.entries.every((e) => e.tenantId === 'tenant-1')).toBe(true);
    expect(snapshot.events.every((e) => e.tenantId === 'tenant-1')).toBe(true);
  });
});
