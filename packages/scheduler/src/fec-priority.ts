/**
 * El orden del barrido FEC cuando hay presupuesto para un barrido de verdad.
 *
 * Con 15 llamadas por hora el barrido tardaba semanas y el orden daba igual:
 * todo llegaba tarde. Con ~600 por hora (S5) el barrido entra en horas, y
 * entonces el orden es la diferencia entre encontrar la ONU degradada en el
 * primer minuto o en la última hora.
 *
 * Reglas, en este orden:
 *
 *   1. Primero las ONUs que los eventos marcaron degradadas.
 *   2. Entre ellas, la peor potencia de recepción primero (la más negativa); la
 *      que no trajo lectura va después de las que sí.
 *   3. Empate de potencia: la señal más reciente primero.
 *   4. Empate de todo: el id, para que el orden sea determinista.
 *   5. Después, el resto del inventario con el round-robin de siempre, para que
 *      ninguna ONU quede sin visitar.
 *
 * Es una función pura: no lee el reloj (cada señal trae su hora), no toca la
 * base y no muta la entrada.
 */
import type { OnuSummary } from '@ftth-copilot/connectors-core';
import type { DegradedOnuSignal } from './degraded-onus';

/** Lo que necesita el ordenamiento. */
export interface FecPriorityInput {
  /** El inventario de ONUs de la conexión. */
  onus: readonly OnuSummary[];
  /** Las señales degradadas vigentes de la conexión. */
  degraded?: readonly DegradedOnuSignal[];
  /** Índice del tick: hace rotar el round-robin del resto. */
  tickIndex: number;
  /** Cuántas ONUs entran en este tick. */
  sliceSize: number;
}

/** Compara dos ONUs por id, sin depender del locale. */
function compareById(a: OnuSummary, b: OnuSummary): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Compara dos señales degradadas por prioridad (la primera es la más urgente). */
function compareDegraded(a: DegradedOnuSignal, b: DegradedOnuSignal): number {
  const aRx = a.rxPowerDbm ?? Number.POSITIVE_INFINITY;
  const bRx = b.rxPowerDbm ?? Number.POSITIVE_INFINITY;
  if (aRx !== bRx) return aRx - bRx;
  if (a.atMs !== b.atMs) return b.atMs - a.atMs;
  return a.onuId < b.onuId ? -1 : a.onuId > b.onuId ? 1 : 0;
}

/**
 * Una ventana rotativa de `count` elementos sobre `items`, que arranca en el
 * hueco del tick. Envuelve el final de la lista.
 */
function rotate<T>(items: readonly T[], tickIndex: number, count: number): T[] {
  const length = items.length;
  if (length === 0 || count <= 0) return [];
  if (count >= length) return [...items];
  const start = ((tickIndex * count) % length + length) % length;
  const end = start + count;
  if (end <= length) return items.slice(start, end);
  return [...items.slice(start, length), ...items.slice(0, end - length)];
}

/**
 * El corte de este tick, en orden de prioridad.
 *
 * Las ONUs degradadas que ya no están en el inventario se ignoran: el evento
 * puede hablar de una ONU que se borró, y no hay nada que leerle.
 */
export function rankFecCandidates(input: FecPriorityInput): OnuSummary[] {
  const { onus, degraded = [], tickIndex, sliceSize } = input;
  if (onus.length === 0 || sliceSize <= 0) return [];

  const byId = new Map(onus.map((onu) => [onu.id, onu]));
  const latest = new Map<string, DegradedOnuSignal>();
  for (const signal of degraded) {
    if (!byId.has(signal.onuId)) continue;
    const current = latest.get(signal.onuId);
    if (current === undefined || signal.atMs > current.atMs) latest.set(signal.onuId, signal);
  }

  const priority = [...latest.values()]
    .sort(compareDegraded)
    .map((signal) => byId.get(signal.onuId))
    .filter((onu): onu is OnuSummary => onu !== undefined);

  if (priority.length >= sliceSize) return priority.slice(0, sliceSize);

  const rest = onus.filter((onu) => !latest.has(onu.id)).sort(compareById);
  return [...priority, ...rotate(rest, tickIndex, sliceSize - priority.length)];
}
