/**
 * Which process owns the background work.
 *
 * `embedded` is the behavior of today: the loops live inside the Next.js
 * process. `worker` is the extracted behavior: the loops live in
 * `services/worker` and the web only enqueues.
 *
 * The default is `embedded` on purpose. The extracted path is only safe to
 * enable after it ran green in staging, and the flag exists so the rollback
 * is a configuration change rather than a code revert.
 */

export const BACKEND_MODES = {
  embedded: 'embedded',
  worker: 'worker',
} as const;

export type BackendMode = (typeof BACKEND_MODES)[keyof typeof BACKEND_MODES];

/** The mode that keeps the current, in-process behavior. */
export const DEFAULT_BACKEND_MODE: BackendMode = BACKEND_MODES.embedded;

/**
 * Reads `BACKEND_MODE`.
 *
 * An unset value means `embedded`. An unrecognized value also means
 * `embedded`: falling back to the behavior that is already proven is safer
 * than guessing that the operator asked for the extracted path.
 */
export function backendMode(env: NodeJS.ProcessEnv = process.env): BackendMode {
  const raw = env['BACKEND_MODE']?.trim().toLowerCase();
  if (!raw) return DEFAULT_BACKEND_MODE;
  if (raw === BACKEND_MODES.worker) return BACKEND_MODES.worker;
  if (raw === BACKEND_MODES.embedded) return BACKEND_MODES.embedded;

  console.warn('[backend-mode] unknown BACKEND_MODE, falling back to embedded', { value: raw });
  return DEFAULT_BACKEND_MODE;
}

/**
 * True when the worker owns the background work, so the web must not start
 * any loop or bind any socket.
 */
export function workerOwnsBackgroundWork(env: NodeJS.ProcessEnv = process.env): boolean {
  return backendMode(env) === BACKEND_MODES.worker;
}
