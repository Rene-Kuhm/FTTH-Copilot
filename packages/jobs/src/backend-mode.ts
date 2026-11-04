/**
 * Which process owns the background work.
 *
 * There is only one answer left: the worker. The in-process path (`embedded`)
 * was removed in task T15, once the worker had run green in staging. The web
 * serves HTTP and the SSE stream; every recurring loop, every UDP receiver and
 * every background job belong to `services/worker`.
 *
 * The flag survives as a guard, not as a selector. An environment that still
 * says `BACKEND_MODE=embedded` is an environment that was never migrated, and
 * that environment would keep serving HTTP while nobody polls anything: the
 * failure would be silent, and the kind that surfaces weeks later. So the
 * value is rejected with an explicit error at boot instead of being ignored.
 */

export const BACKEND_MODES = {
  worker: 'worker',
} as const;

export type BackendMode = (typeof BACKEND_MODES)[keyof typeof BACKEND_MODES];

/** The mode that owns the background work. There is no other one. */
export const DEFAULT_BACKEND_MODE: BackendMode = BACKEND_MODES.worker;

/**
 * Validates `BACKEND_MODE`.
 *
 * An unset value means the worker: that is the default, and the only owner
 * there is. Any other value — `embedded` from an environment that predates
 * the cut-over, or a typo — throws.
 *
 * The error is meant to be read by whoever deploys: it says what the
 * environment asked for and what to do instead.
 */
export function assertWorkerBackendMode(env: NodeJS.ProcessEnv = process.env): void {
  const raw = env['BACKEND_MODE']?.trim().toLowerCase();
  if (!raw || raw === BACKEND_MODES.worker) return;

  throw new Error(
    `BACKEND_MODE="${raw}" ya no existe. El camino embedded (los loops y los receptores ` +
      `dentro de la web) se eliminó: el worker es el único dueño del trabajo de fondo. ` +
      `Desplegá el worker y usá BACKEND_MODE=${DEFAULT_BACKEND_MODE}, o quitá la variable.`,
  );
}
