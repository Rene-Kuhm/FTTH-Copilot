/**
 * El contrato canónico de etiquetas y el umbral de muestra mínima viven en
 * `packages/shared` (Fase 0 del learning loop).
 *
 * Antes de que existiera, el juego cerrado de etiquetas estaba copiado en
 * `packages/eval` y en `apps/web/lib/investigations/feedback.ts`, y el umbral
 * de muestra solo en `packages/eval`. Este test fija la fuente única: si
 * alguien vuelve a copiar el juego cerrado en otro paquete, el duplicado
 * aparece como una constante que ya no es la de acá.
 */
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LEARNING_MODE,
  DEFAULT_MIN_SAMPLE_SIZE,
  FEEDBACK_LABELS,
  FEEDBACK_LABEL_CONFIRMED,
  FEEDBACK_LABEL_INCORRECT,
  FEEDBACK_LABEL_INSUFFICIENT,
  LEARNING_MODES,
  RESOLVED_LABELS,
  RESOLVED_LABEL_CONFLICTED,
  isFeedbackLabel,
  isLearningMode,
} from '../src/learning';

describe('learning — contrato canónico', () => {
  it('el juego cerrado de etiquetas es exactamente el de Fase 1', () => {
    expect(FEEDBACK_LABELS).toEqual(['confirmed', 'incorrect', 'insufficient_data']);
    expect(FEEDBACK_LABEL_CONFIRMED).toBe('confirmed');
    expect(FEEDBACK_LABEL_INCORRECT).toBe('incorrect');
    expect(FEEDBACK_LABEL_INSUFFICIENT).toBe('insufficient_data');
  });

  it('el type guard acepta las tres etiquetas y rechaza el resto', () => {
    for (const label of FEEDBACK_LABELS) {
      expect(isFeedbackLabel(label)).toBe(true);
    }
    expect(isFeedbackLabel('confirmed ')).toBe(false);
    expect(isFeedbackLabel('maybe')).toBe(false);
    expect(isFeedbackLabel('')).toBe(false);
    expect(isFeedbackLabel(undefined)).toBe(false);
    expect(isFeedbackLabel(null)).toBe(false);
    expect(isFeedbackLabel(7)).toBe(false);
  });

  it('la etiqueta resuelta agrega `conflicted` al juego cerrado', () => {
    expect(RESOLVED_LABEL_CONFLICTED).toBe('conflicted');
    expect(RESOLVED_LABELS).toEqual([
      'confirmed',
      'incorrect',
      'insufficient_data',
      'conflicted',
    ]);
  });

  it('el umbral de muestra mínima es 30 (regla 1.6 del roadmap)', () => {
    expect(DEFAULT_MIN_SAMPLE_SIZE).toBe(30);
  });
});

// ── T1.1 — el interruptor del learning loop ────────────────────────────────

describe('learning — interruptor por tenant (T1.1)', () => {
  it('el juego cerrado de modos es exactamente off, shadow, active', () => {
    expect(LEARNING_MODES).toEqual(['off', 'shadow', 'active']);
  });

  it('el default es `off`: desplegar el código no cambia lo que ve el operador', () => {
    expect(DEFAULT_LEARNING_MODE).toBe('off');
  });

  it('isLearningMode acepta los tres modos y rechaza cualquier otra cosa', () => {
    expect(isLearningMode('off')).toBe(true);
    expect(isLearningMode('shadow')).toBe(true);
    expect(isLearningMode('active')).toBe(true);
    expect(isLearningMode('enabled')).toBe(false);
    expect(isLearningMode('OFF')).toBe(false);
    expect(isLearningMode('')).toBe(false);
    expect(isLearningMode(undefined)).toBe(false);
    expect(isLearningMode(null)).toBe(false);
    expect(isLearningMode(7)).toBe(false);
  });
});
