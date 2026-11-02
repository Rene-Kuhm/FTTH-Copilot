/**
 * T0.4 — `sampleSufficiency` según la invariante I10.
 *
 * I10, textual: *Si una métrica no tiene muestra mínima, se reporta
 * `insuficiente`, nunca un número (regla 1.6 del roadmap, ya aplicada en
 * `computeFeedbackSummary`). Un artefacto sin muestra mínima no se puede
 * promover.*
 *
 * El umbral es el mismo que usa `computeFeedbackSummary`: ambos leen
 * `DEFAULT_MIN_SAMPLE_SIZE` de `@ftth-copilot/shared`.
 */
import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_MIN_SAMPLE_SIZE } from '@ftth-copilot/shared';

import { sampleSufficiency, sufficiencyReport } from '../src/sufficiency';

describe('sampleSufficiency — la métrica se publica o no', () => {
  it('bajo el umbral devuelve insuficiente y el valor es null', () => {
    const result = sampleSufficiency(29, () => 0.87);

    expect(result.status).toBe('insufficient');
    expect(result.value).toBeNull();
    expect(result.sampleSize).toBe(29);
    expect(result.minSampleSize).toBe(DEFAULT_MIN_SAMPLE_SIZE);
  });

  it('en el umbral exacto ya es suficiente', () => {
    const result = sampleSufficiency(DEFAULT_MIN_SAMPLE_SIZE, () => 0.87);

    expect(result.status).toBe('sufficient');
    expect(result.value).toBe(0.87);
  });

  it('por encima del umbral es suficiente', () => {
    const result = sampleSufficiency(120, () => 0.5);

    expect(result.status).toBe('sufficient');
    expect(result.value).toBe(0.5);
  });

  it('bajo el umbral el valor ni siquiera se calcula', () => {
    const compute = vi.fn(() => 0.99);

    const result = sampleSufficiency(3, compute);

    expect(compute).not.toHaveBeenCalled();
    expect(result.value).toBeNull();
  });

  it('el umbral por defecto es el de `computeFeedbackSummary`', () => {
    const result = sampleSufficiency(1, () => 1);

    expect(result.minSampleSize).toBe(30);
    expect(result.minSampleSize).toBe(DEFAULT_MIN_SAMPLE_SIZE);
  });

  it('el umbral se puede ajustar por llamada', () => {
    const result = sampleSufficiency(5, () => 0.4, { minSampleSize: 5 });

    expect(result.status).toBe('sufficient');
    expect(result.value).toBe(0.4);
    expect(result.minSampleSize).toBe(5);
  });

  it('una muestra negativa o inválida es insuficiente', () => {
    expect(sampleSufficiency(-1, () => 1).status).toBe('insufficient');
    expect(sampleSufficiency(Number.NaN, () => 1).status).toBe('insufficient');
    expect(sampleSufficiency(Number.POSITIVE_INFINITY, () => 1).status).toBe('insufficient');
  });

  it('sin muestra (cero) es insuficiente', () => {
    const result = sampleSufficiency(0, () => 0.5);

    expect(result.status).toBe('insufficient');
    expect(result.value).toBeNull();
  });
});

describe('sufficiencyReport — ninguna métrica se publica por debajo del umbral', () => {
  it('cada métrica declara su estado', () => {
    const report = sufficiencyReport([
      { name: 'precision', sampleSize: 40 },
      { name: 'recall', sampleSize: 12 },
    ]);

    expect(report.minSampleSize).toBe(DEFAULT_MIN_SAMPLE_SIZE);
    expect(report.metrics).toEqual([
      {
        name: 'precision',
        status: 'sufficient',
        sampleSize: 40,
        minSampleSize: DEFAULT_MIN_SAMPLE_SIZE,
      },
      {
        name: 'recall',
        status: 'insufficient',
        sampleSize: 12,
        minSampleSize: DEFAULT_MIN_SAMPLE_SIZE,
      },
    ]);
  });

  it('un artefacto solo está calibrado si todas las métricas tienen muestra', () => {
    const completo = sufficiencyReport([
      { name: 'precision', sampleSize: 40 },
      { name: 'recall', sampleSize: 31 },
    ]);
    const incompleto = sufficiencyReport([
      { name: 'precision', sampleSize: 40 },
      { name: 'recall', sampleSize: 3 },
    ]);

    expect(completo.isCalibrated).toBe(true);
    expect(incompleto.isCalibrated).toBe(false);
  });

  it('un reporte sin métricas no está calibrado', () => {
    const report = sufficiencyReport([]);

    expect(report.metrics).toEqual([]);
    expect(report.isCalibrated).toBe(false);
  });

  it('el umbral se puede ajustar por llamada', () => {
    const report = sufficiencyReport([{ name: 'recall', sampleSize: 10 }], {
      minSampleSize: 10,
    });

    expect(report.metrics[0]?.status).toBe('sufficient');
    expect(report.isCalibrated).toBe(true);
  });
});
