/**
 * `@ftth-copilot/learning` — núcleo puro del learning loop (Fase 0).
 *
 * Todo lo que hay acá son funciones deterministas: sin Prisma, sin Redis,
 * sin red y sin reloj implícito. El tiempo entra siempre como parámetro.
 * La persistencia es del worker; la web solo lee artefactos ya publicados.
 *
 * La superficie pública de esta fase:
 *
 * - `resolveLabels` (T0.2) — resolución de etiquetas según D1: última
 *   opinión por autor, consenso, y `conflicted` cuando los técnicos
 *   discrepan.
 * - `groupIntoEvents` y `temporalSplit` (T0.3) — agrupación por ancestro
 *   topológico y ventana, y split temporal sin fuga entre train y eval (D9).
 * - `sampleSufficiency` (T0.4) — insuficiencia honesta: bajo la muestra
 *   mínima la métrica no se publica (I10).
 */
export * from './types';
export * from './errors';
export * from './labels';
export * from './events';
