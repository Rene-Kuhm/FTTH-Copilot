/**
 * T1.1 — el interruptor del learning loop por tenant.
 *
 * Resuelve el modo (`off → shadow → active`) y los pins de artefacto con la
 * misma precedencia que el resto de los knobs de `TenantPolicy`:
 * `args.X ?? tenantPolicy.X ?? default.X`.
 *
 * Todo es puro: recibe la política del tenant como dato y devuelve el valor
 * resuelto. No lee la base, no lee el reloj (AGENTS.md §4).
 *
 * El default es `off`: desplegar el código no cambia lo que ve el operador.
 * El pin es lo que hace el rollback posible sin deploy — se vuelve a la
 * versión anterior del artefacto, o se deja el modo en `off`.
 */
import { DEFAULT_LEARNING_MODE, type LearningMode } from '@ftth-copilot/shared';

export type { LearningMode };

export { DEFAULT_LEARNING_MODE };

/** Los pins de artefacto: capa → versión. */
export type LearningArtifactPins = Readonly<Record<string, string>>;

/**
 * El slice de `TenantPolicy` que este módulo consulta.
 *
 * Definido estructuralmente, como el de `packages/evidence`: el paquete
 * puro no puede arrastrar la fila de Prisma por su grafo de imports.
 */
export interface LearningPolicySnapshot {
  readonly learningMode?: LearningMode | null;
  readonly learningArtifactPins?: LearningArtifactPins | null;
}

/** Lo que el runtime puede pasar por encima de la política del tenant. */
export interface ResolveLearningPolicyArgs {
  /** El modo que impone el runtime, si impone alguno. */
  readonly mode?: LearningMode | null;
  /** Los pins que impone el runtime, si impone alguno. */
  readonly pins?: LearningArtifactPins | null;
  /** La fila de `TenantPolicy` del tenant, si existe. */
  readonly tenantPolicy?: LearningPolicySnapshot | null;
}

/**
 * El modo efectivo del tenant.
 *
 * `null` y `undefined` se tratan igual: la precedencia `??` los saltea y
 * cae al siguiente eslabón.
 */
export function resolveLearningMode(args: ResolveLearningPolicyArgs = {}): LearningMode {
  return args.mode ?? args.tenantPolicy?.learningMode ?? DEFAULT_LEARNING_MODE;
}

/**
 * Los pins efectivos del tenant.
 *
 * Devuelve una copia: el llamador no puede mutar el mapa de la política.
 */
export function resolveArtifactPins(args: ResolveLearningPolicyArgs = {}): Record<string, string> {
  const pins = args.pins ?? args.tenantPolicy?.learningArtifactPins ?? {};
  return { ...pins };
}
