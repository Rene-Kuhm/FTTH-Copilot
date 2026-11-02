/**
 * Versión del núcleo de learning que produce los artefactos.
 *
 * Entra en el hash del snapshot: si cambia la versión del código, cambia
 * el hash, aunque el dataset sea idéntico. Sin eso, dos snapshots con el
 * mismo hash podrían haber sido calculados por códigos distintos.
 *
 * `scripts/check-release-version.ts` verifica que esta constante coincida con
 * la versión del release, igual que hace con el scope de telemetría de
 * `packages/agent-core`.
 */
export const LEARNING_CODE_VERSION = '0.2.2';
