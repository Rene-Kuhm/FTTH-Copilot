import { expireStaleRuns } from '@/lib/investigations/pipeline';

/**
 * Barrido de intentos de investigación abandonados, en modo `embedded`.
 *
 * En modo `worker` lo hace el worker como job programado. En `embedded` (el
 * default hasta el corte) no hay worker, y sin este loop una investigación cuyo
 * proceso murió a mitad, o las filas trabadas antes del arreglo de T12, nunca
 * saldrían de `pending`: el botón "investigar" quedaría bloqueado.
 */

/** Edad a partir de la cual un intento `pending` se considera abandonado. */
export const DEFAULT_INVESTIGATION_PENDING_TTL_MS = 15 * 60 * 1000;
/** Cada cuánto corre el barrido. */
export const DEFAULT_INVESTIGATION_SWEEP_INTERVAL_MS = 60 * 1000;

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Arranca el barrido una sola vez por proceso. */
export function startInvestigationSweep(env: NodeJS.ProcessEnv = process.env): void {
  if (timer !== null) return;
  const ttlMs = positiveInt(env['INVESTIGATION_PENDING_TTL_MS'], DEFAULT_INVESTIGATION_PENDING_TTL_MS);
  const everyMs = positiveInt(env['INVESTIGATION_SWEEP_INTERVAL_MS'], DEFAULT_INVESTIGATION_SWEEP_INTERVAL_MS);

  const sweep = async () => {
    try {
      const expired = await expireStaleRuns({ ttlMs });
      if (expired > 0) {
        console.warn(`[investigate] sweep expired ${expired} abandoned attempt(s)`);
      }
    } catch (error) {
      console.error('[investigate] sweep failed', error);
    }
  };

  timer = setInterval(() => void sweep(), everyMs);
  // The sweep must never keep the process alive on its own.
  timer.unref?.();
}

/** Para tests: detiene el barrido. */
export function stopInvestigationSweep(): void {
  if (timer !== null) clearInterval(timer);
  timer = null;
}
