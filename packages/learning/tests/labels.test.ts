/**
 * T0.2 — `resolveLabels` según la decisión D1 del learning loop.
 *
 * D1, textual:
 *   1. Para cada `authorUserId`, quedarse con la fila de `submittedAt` más
 *      reciente (el historial se conserva en la tabla, pero solo cuenta la
 *      última opinión de cada técnico).
 *   2. Si todos los autores coinciden → esa etiqueta.
 *   3. Si discrepan → `conflicted`, excluido del entrenamiento y contado
 *      aparte como métrica.
 *   4. `insufficient_data` nunca es positivo ni negativo para L3: es una
 *      etiqueta de abstención correcta y alimenta el corpus de I7.
 */
import { describe, expect, it } from 'vitest';

import { resolveLabels, partitionForTraining } from '../src/labels';
import type { LearningFeedbackRow } from '../src/types';

function row(overrides: Partial<LearningFeedbackRow> = {}): LearningFeedbackRow {
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

describe('resolveLabels — última opinión por autor', () => {
  it('un solo autor resuelve su etiqueta', () => {
    const result = resolveLabels([row({ label: 'confirmed' })]);

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({
      tenantId: 'tenant-1',
      versionId: 'v_1',
      label: 'confirmed',
      authorCount: 1,
    });
  });

  it('el mismo autor con dos etiquetas resuelve la más reciente', () => {
    const result = resolveLabels([
      row({ feedbackId: 'f_old', label: 'incorrect', submittedAt: '2026-10-01T10:00:00.000Z' }),
      row({ feedbackId: 'f_new', label: 'confirmed', submittedAt: '2026-10-01T12:00:00.000Z' }),
    ]);

    expect(result.entries[0]?.label).toBe('confirmed');
    expect(result.entries[0]?.feedbackIds).toEqual(['f_new']);
    expect(result.counts.confirmed).toBe(1);
    expect(result.counts.incorrect).toBe(0);
  });

  it('el desempate de dos filas del mismo autor con la misma fecha es determinista', () => {
    const rows = [
      row({ feedbackId: 'f_a', label: 'confirmed', submittedAt: '2026-10-01T10:00:00.000Z' }),
      row({ feedbackId: 'f_b', label: 'incorrect', submittedAt: '2026-10-01T10:00:00.000Z' }),
    ];

    const primero = resolveLabels(rows);
    const reordenado = resolveLabels([...rows].reverse());

    expect(primero.entries[0]?.label).toBe(reordenado.entries[0]?.label);
    expect(primero.entries[0]?.feedbackIds).toEqual(reordenado.entries[0]?.feedbackIds);
  });

  it('el historial discarded no cuenta: solo se conserva la última opinión', () => {
    const result = resolveLabels([
      row({ feedbackId: 'f_old', label: 'incorrect', submittedAt: '2026-10-01T10:00:00.000Z' }),
      row({ feedbackId: 'f_new', label: 'confirmed', submittedAt: '2026-10-01T12:00:00.000Z' }),
    ]);

    expect(result.counts.confirmed).toBe(1);
    expect(result.counts.incorrect).toBe(0);
    expect(result.counts.conflicted).toBe(0);
  });
});

describe('resolveLabels — consenso entre autores', () => {
  it('dos autores que coinciden resuelven esa etiqueta', () => {
    const result = resolveLabels([
      row({ feedbackId: 'f_1', authorUserId: 'u_1', label: 'confirmed' }),
      row({
        feedbackId: 'f_2',
        authorUserId: 'u_2',
        label: 'confirmed',
        submittedAt: '2026-10-01T11:00:00.000Z',
      }),
    ]);

    expect(result.entries[0]?.label).toBe('confirmed');
    expect(result.entries[0]?.authorCount).toBe(2);
    expect(result.counts.confirmed).toBe(1);
  });

  it('dos autores que discrepan resuelven `conflicted`', () => {
    const result = resolveLabels([
      row({ feedbackId: 'f_1', authorUserId: 'u_1', label: 'confirmed' }),
      row({
        feedbackId: 'f_2',
        authorUserId: 'u_2',
        label: 'incorrect',
        submittedAt: '2026-10-01T11:00:00.000Z',
      }),
    ]);

    expect(result.entries[0]?.label).toBe('conflicted');
    expect(result.entries[0]?.authorCount).toBe(2);
    expect(result.counts.conflicted).toBe(1);
    expect(result.counts.confirmed).toBe(0);
    expect(result.counts.incorrect).toBe(0);
  });

  it('`conflicted` queda fuera del entrenamiento y se cuenta aparte', () => {
    const result = resolveLabels([
      row({ feedbackId: 'f_1', authorUserId: 'u_1', label: 'confirmed' }),
      row({
        feedbackId: 'f_2',
        authorUserId: 'u_2',
        label: 'incorrect',
        submittedAt: '2026-10-01T11:00:00.000Z',
      }),
    ]);

    const partition = partitionForTraining(result);
    expect(partition.positives).toHaveLength(0);
    expect(partition.negatives).toHaveLength(0);
    expect(partition.abstentions).toHaveLength(0);
    expect(partition.conflicted).toHaveLength(1);
  });

  it('un autor con `insufficient_data` y otro con `confirmed` discrepan', () => {
    const result = resolveLabels([
      row({ feedbackId: 'f_1', authorUserId: 'u_1', label: 'insufficient_data' }),
      row({
        feedbackId: 'f_2',
        authorUserId: 'u_2',
        label: 'confirmed',
        submittedAt: '2026-10-01T11:00:00.000Z',
      }),
    ]);

    expect(result.entries[0]?.label).toBe('conflicted');
    expect(result.counts.conflicted).toBe(1);
    expect(result.counts.insufficientData).toBe(0);
  });
});

describe('resolveLabels — `insufficient_data` nunca es positivo ni negativo', () => {
  it('una abstención unanimous va al corpus de abstención, no al entrenamiento', () => {
    const result = resolveLabels([row({ label: 'insufficient_data' })]);

    expect(result.entries[0]?.label).toBe('insufficient_data');
    expect(result.counts.insufficientData).toBe(1);

    const partition = partitionForTraining(result);
    expect(partition.positives).toHaveLength(0);
    expect(partition.negatives).toHaveLength(0);
    expect(partition.abstentions).toHaveLength(1);
  });

  it('el reparto separa positivos, negativos y abstenciones', () => {
    const result = resolveLabels([
      row({ versionId: 'v_1', feedbackId: 'f_1', label: 'confirmed' }),
      row({
        versionId: 'v_2',
        feedbackId: 'f_2',
        label: 'incorrect',
        submittedAt: '2026-10-01T11:00:00.000Z',
      }),
      row({
        versionId: 'v_3',
        feedbackId: 'f_3',
        label: 'insufficient_data',
        submittedAt: '2026-10-01T12:00:00.000Z',
      }),
    ]);

    const partition = partitionForTraining(result);
    expect(partition.positives.map((e) => e.versionId)).toEqual(['v_1']);
    expect(partition.negatives.map((e) => e.versionId)).toEqual(['v_2']);
    expect(partition.abstentions.map((e) => e.versionId)).toEqual(['v_3']);
  });
});

describe('resolveLabels — filas que no se pueden usar', () => {
  it('una fila huérfana de versión se descarta y se cuenta', () => {
    const result = resolveLabels([row({ versionId: 'v_desconocida' })], {
      knownVersionIds: new Set(['v_1']),
    });

    expect(result.entries).toHaveLength(0);
    expect(result.discarded.orphanVersion).toBe(1);
    expect(result.discarded.invalidLabel).toBe(0);
  });

  it('una versión conocida no se descarta', () => {
    const result = resolveLabels([row({ versionId: 'v_1' })], {
      knownVersionIds: new Set(['v_1']),
    });

    expect(result.entries).toHaveLength(1);
    expect(result.discarded.orphanVersion).toBe(0);
  });

  it('una etiqueta fuera del juego cerrado se descarta y se cuenta', () => {
    const result = resolveLabels([row({ label: 'quiza_mal' })]);

    expect(result.entries).toHaveLength(0);
    expect(result.discarded.invalidLabel).toBe(1);
  });

  it('una fila estructuralmente rota se descarta y se cuenta', () => {
    const result = resolveLabels([
      row({ feedbackId: '' }),
      row({ feedbackId: 'f_2', submittedAt: 'no-es-una-fecha' }),
    ]);

    expect(result.entries).toHaveLength(0);
    expect(result.discarded.malformed).toBe(2);
  });

  it('sin `knownVersionIds` no se descarta ninguna fila por versión', () => {
    const result = resolveLabels([row({ versionId: 'v_cualquiera' })]);

    expect(result.entries).toHaveLength(1);
    expect(result.discarded.orphanVersion).toBe(0);
  });
});

describe('resolveLabels — determinismo y aislamiento', () => {
  it('el resultado no depende del orden de las filas', () => {
    const rows = [
      row({ versionId: 'v_2', feedbackId: 'f_2', label: 'incorrect' }),
      row({ versionId: 'v_1', feedbackId: 'f_1', label: 'confirmed' }),
      row({
        versionId: 'v_3',
        feedbackId: 'f_3',
        authorUserId: 'u_2',
        label: 'insufficient_data',
        submittedAt: '2026-10-01T13:00:00.000Z',
      }),
    ];

    expect(resolveLabels(rows)).toEqual(resolveLabels([...rows].reverse()));
  });

  it('las entradas salen ordenadas por tenant y versión', () => {
    const result = resolveLabels([
      row({ tenantId: 'tenant-2', versionId: 'v_b', feedbackId: 'f_3' }),
      row({ tenantId: 'tenant-1', versionId: 'v_b', feedbackId: 'f_2' }),
      row({ tenantId: 'tenant-1', versionId: 'v_a', feedbackId: 'f_1' }),
    ]);

    expect(result.entries.map((e) => `${e.tenantId}/${e.versionId}`)).toEqual([
      'tenant-1/v_a',
      'tenant-1/v_b',
      'tenant-2/v_b',
    ]);
  });

  it('dos tenants no se mezclan aunque compartan versionId', () => {
    const result = resolveLabels([
      row({ tenantId: 'tenant-1', versionId: 'v_1', feedbackId: 'f_1', label: 'confirmed' }),
      row({
        tenantId: 'tenant-2',
        versionId: 'v_1',
        feedbackId: 'f_2',
        label: 'incorrect',
        submittedAt: '2026-10-01T11:00:00.000Z',
      }),
    ]);

    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]).toMatchObject({ tenantId: 'tenant-1', label: 'confirmed' });
    expect(result.entries[1]).toMatchObject({ tenantId: 'tenant-2', label: 'incorrect' });
  });

  it('sin filas devuelve un resultado vacío y honesto', () => {
    const result = resolveLabels([]);

    expect(result.entries).toEqual([]);
    expect(result.counts).toEqual({
      confirmed: 0,
      incorrect: 0,
      insufficientData: 0,
      conflicted: 0,
    });
    expect(result.discarded).toEqual({ invalidLabel: 0, orphanVersion: 0, malformed: 0 });
  });
});
