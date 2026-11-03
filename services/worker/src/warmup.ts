/**
 * El tick de calentamiento de un loop.
 *
 * El schedule de un loop es una rejilla, y el `upsertJobScheduler` de
 * BullMQ **no** reprograma una rejilla que ya existe: keeps la iteración
 * que había. Después de un reinicio, el próximo tick de un loop es el que
 * la rejilla tenía previsto — y para el firmware ese tick está a 24 h.
 *
 * El tick de calentamiento es lo que hace que el loop pruebe que funciona
 * enseguida después de un reinicio, en lugar de desaparecer hasta el
 * próximo turno de la rejilla. Pero es trabajo duplicado en dos casos:
 *
 *   - cuando el schedule ya tiene un tick a la vista (ese tick *es* el
 *     calentamiento);
 *   - cuando lo fuerzan dos workers a la vez (el id del job sale de la
 *     ranura de la rejilla, y BullMQ encola un solo job por id).
 *
 * La decisión es pura a propósito: el reloj y la rejilla entran como datos
 * y el comportamiento se prueba sin Redis.
 */

import { sanitizeJobScope } from '@ftth-copilot/jobs';

/**
 * Grace period before the first tick of a loop, in milliseconds.
 *
 * The in-process loops ran a warm-up five seconds after boot. The schedule
 * starts at the same instant, so the first poll lands five seconds after the
 * worker comes up instead of one full interval later.
 */
export const WARMUP_MS = 5_000;

/**
 * How long the loop's own tick counts as "soon enough".
 *
 * Dentro de esta ventana el tick del schedule sirve de calentamiento: forzarlo
 * sería un segundo poll en la misma ventana.
 */
export const WARMUP_WINDOW_MS = 60_000;

/**
 * The decision about the warm-up tick of a loop.
 */
export interface WarmupDecision {
  /** Whether a warm-up tick has to be forced. */
  force: boolean;
  /** Why the decision is what it is. */
  reason: string;
}

/**
 * Decides whether the warm-up tick of a loop has to be forced.
 *
 * The input is the next run of the schedule and the clock. When the next
 * run is far away, the loop would stay silent for that long after the
 * restart: the warm-up is what makes it prove that it works right away.
 */
export function decideWarmup(input: {
  /** Epoch ms of the next tick the schedule will produce, or null. */
  nextRunAtMs: number | null;
  /** The clock. */
  nowMs: number;
}): WarmupDecision {
  const { nextRunAtMs, nowMs } = input;

  if (nextRunAtMs === null) {
    return {
      force: false,
      reason: 'el schedule no tiene un próximo tick conocido',
    };
  }

  if (nextRunAtMs - nowMs <= WARMUP_WINDOW_MS) {
    return {
      force: false,
      reason: 'el schedule ya tiene un tick a la vista',
    };
  }

  return {
    force: true,
    reason: 'el próximo tick del schedule está lejos',
  };
}

/**
 * The id of the warm-up job of a loop.
 *
 * It comes from the scope of the loop and from the slot of the schedule the
 * warm-up belongs to. Two workers that boot while the schedule is in the
 * same slot compute the same id, and BullMQ refuses to enqueue a second job
 * with an id that already exists: the warm-up happens once.
 *
 * The slot is also what keeps a restart from warming the loop twice: the
 * id of a slot that already warmed up is taken, and BullMQ lo ignora.
 */
export function warmupJobId(scope: string, slotMs: number): string {
  return `warmup-${sanitizeJobScope(scope)}-${slotMs}`;
}
