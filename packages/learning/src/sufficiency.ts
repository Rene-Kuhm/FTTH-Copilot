/**
 * T0.4 — Insuficiencia honesta (invariante I10).
 *
 * I10, textual: *Si una métrica no tiene muestra mínima, se reporta
 * `insuficiente`, nunca un número. Un artefacto sin muestra mínima no se
 * puede promover.*
 *
 * El umbral es el mismo que usa `computeFeedbackSummary` en
 * `packages/eval`: los dos leen `DEFAULT_MIN_SAMPLE_SIZE` de
 * `@ftth-copilot/shared`. No hay dos umbrales que puedan divergir.
 *
 * La función de cómputo **no se invoca** bajo el umbral: así no hay forma de
 * que un número se escape por un camino lateral.
 */
import { DEFAULT_MIN_SAMPLE_SIZE } from '@ftth-copilot/shared';

import type { MetricSample, SufficiencyReport, SufficiencyResult } from './types';

/** Opciones de `sampleSufficiency`. */
export interface SampleSufficiencyOptions {
  /**
   * Umbral contra el que se compara la muestra. Por defecto es
   * `DEFAULT_MIN_SAMPLE_SIZE`: el mismo que usa `computeFeedbackSummary`.
   */
  readonly minSampleSize?: number;
}

/**
 * Evalúa una métrica contra su muestra mínima.
 *
 * Bajo el umbral devuelve `insufficient` con `value: null` — nunca un
 * número. La función `compute` solo se invoca cuando hay muestra
 * suficiente.
 */
export function sampleSufficiency<T>(
  sampleSize: number,
  compute: (sampleSize: number) => T,
  options: SampleSufficiencyOptions = {},
): SufficiencyResult<T> {
  const minSampleSize = options.minSampleSize ?? DEFAULT_MIN_SAMPLE_SIZE;

  if (!Number.isFinite(sampleSize) || sampleSize < minSampleSize) {
    return { status: 'insufficient', value: null, sampleSize, minSampleSize };
  }

  return { status: 'sufficient', value: compute(sampleSize), sampleSize, minSampleSize };
}

/**
 * Estado de suficiencia de un conjunto de métricas.
 *
 * `isCalibrated` es `true` solo si **todas** las métricas tienen muestra
 * suficiente: un artefacto con una sola métrica sin muestra no se puede
 * promover (I10).
 */
export function sufficiencyReport(
  metrics: readonly MetricSample[],
  options: SampleSufficiencyOptions = {},
): SufficiencyReport {
  const minSampleSize = options.minSampleSize ?? DEFAULT_MIN_SAMPLE_SIZE;

  const evaluated = metrics.map((metric) => ({
    name: metric.name,
    status:
      Number.isFinite(metric.sampleSize) && metric.sampleSize >= minSampleSize
        ? ('sufficient' as const)
        : ('insufficient' as const),
    sampleSize: metric.sampleSize,
    minSampleSize,
  }));

  return {
    minSampleSize,
    metrics: evaluated,
    isCalibrated: evaluated.length > 0 && evaluated.every((m) => m.status === 'sufficient'),
  };
}
