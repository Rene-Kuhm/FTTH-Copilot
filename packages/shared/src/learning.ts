/**
 * Contratos canónicos del learning loop (Fase 0 — `odd/tasks/learning-loop.md`).
 *
 * Este módulo es la **única** definición de la etiqueta de feedback y del
 * umbral de muestra mínima. Antes de que existiera, el mismo juego cerrado
 * de etiquetas estaba copiado en `packages/eval` y en
 * `apps/web/lib/investigations/feedback.ts`, y el umbral de muestra vivía
 * solo en `packages/eval`. AGENTS.md §4 es explícito: *un tipo duplicado en
 * dos paquetes es un bug*.
 *
 * - `packages/eval` reexporta estos símbolos para no romper su API pública.
 * - `apps/web` reexporta los suyos para no cambiar la ruta de import.
 * - `packages/learning` los importa directo: es puro y no puede depender de
 *   `packages/eval` (arrastraría Prisma).
 *
 * El umbral de muestra es la regla 1.6 del roadmap: *si faltan etiquetas,
 * mostrar insuficiencia, nunca precisión inventada*.
 */

/** Etiqueta positiva: el técnico confirma el diagnóstico. */
export const FEEDBACK_LABEL_CONFIRMED = 'confirmed' as const;
/** Etiqueta negativa: el técnico marca el diagnóstico como incorrecto. */
export const FEEDBACK_LABEL_INCORRECT = 'incorrect' as const;
/** Abstención correcta: no había datos suficientes para concluir. */
export const FEEDBACK_LABEL_INSUFFICIENT = 'insufficient_data' as const;

/** Juego cerrado de etiquetas de feedback. */
export const FEEDBACK_LABELS = [
  FEEDBACK_LABEL_CONFIRMED,
  FEEDBACK_LABEL_INCORRECT,
  FEEDBACK_LABEL_INSUFFICIENT,
] as const;

/** Tipo de etiqueta de feedback. */
export type FeedbackLabel = (typeof FEEDBACK_LABELS)[number];

/** ¿El valor es una etiqueta de feedback del juego cerrado? */
export function isFeedbackLabel(value: unknown): value is FeedbackLabel {
  return typeof value === 'string' && (FEEDBACK_LABELS as readonly string[]).includes(value);
}

/**
 * Resultado de un desacuerdo entre técnicos (decisión D1). **No** es una
 * etiqueta de feedback: nunca entra al entrenamiento y se cuenta aparte,
 * porque una tasa alta de conflicto es en sí misma una métrica útil.
 */
export const RESOLVED_LABEL_CONFLICTED = 'conflicted' as const;

/** Juego cerrado de resultados de resolución de etiquetas. */
export const RESOLVED_LABELS = [
  ...FEEDBACK_LABELS,
  RESOLVED_LABEL_CONFLICTED,
] as const;

/** Tipo de etiqueta ya resuelta para un `(tenantId, versionId)`. */
export type ResolvedLabel = (typeof RESOLVED_LABELS)[number];

/**
 * Muestra mínima por defecto para poder reportar una métrica (regla 1.6
 * del roadmap). Debajo del umbral, la métrica se declara `insuficiente`;
 * nunca se publica un número.
 */
export const DEFAULT_MIN_SAMPLE_SIZE = 30;

// ── El interruptor del learning loop (T1.1) ─────────────────────────────────
//
// El modo vive acá, y no en `packages/learning`, porque lo consultan tres
// paquetes: el núcleo puro (que resuelve la precedencia), `packages/evidence`
// (que NO puede importar a learning — la pared del Truth Gate, I1) y el
// runtime. AGENTS.md §4: un tipo duplicado en dos paquetes es un bug.
//
// `off` es el default y no un caso excepcional: desplegar el código no
// cambia lo que ve el operador. `shadow` calcula la salida aprendida y la
// registra al lado de la actual, pero el usuario sigue viendo la actual.

/** Juego cerrado de modos del learning loop. */
export const LEARNING_MODES = ['off', 'shadow', 'active'] as const;

/** Tipo de modo del learning loop. */
export type LearningMode = (typeof LEARNING_MODES)[number];

/** Modo por defecto: el learning loop apagado. */
export const DEFAULT_LEARNING_MODE: LearningMode = 'off';

/** ¿El valor es un modo del learning loop? */
export function isLearningMode(value: unknown): value is LearningMode {
  return typeof value === 'string' && (LEARNING_MODES as readonly string[]).includes(value);
}
