/**
 * Las ONUs que los eventos marcaron degradadas (S5).
 *
 * El barrido FEC ya no recorre el inventario en orden: primero va a las ONUs
 * que los eventos de SmartOLT señalan como degradadas, y después sigue el
 * round-robin. Para eso el loop de eventos, que corre en el mismo proceso,
 * anota acá lo que vio.
 *
 * El registro vive en memoria del proceso, igual que el resto del estado de los
 * loops: el worker es el único dueño del trabajo de fondo y no hay una tabla
 * nueva (`packages/db/prisma/migrations` es una superficie protegida). Cada
 * señal lleva su hora, así que el vencimiento lo decide quien consulta y no un
 * `Date.now()` escondido: el barrido FEC recibe el reloj como parámetro y esta
 * pieza es determinista.
 */

/** Por qué se marcó la ONU. */
export type DegradedOnuReason =
  | 'status_changed'
  | 'signal_changed'
  | 'signal_reading'
  | 'rx1490_reading';

/** Una ONU degradada, con la evidencia que la marcó. */
export interface DegradedOnuSignal {
  /** Id de la ONU, el mismo que usa el inventario (`unique_external_id`). */
  onuId: string;
  /** Epoch ms del evento que la marcó. */
  atMs: number;
  /** Última potencia de recepción conocida, si el evento la trajo. */
  rxPowerDbm?: number;
  /** Qué evento la marcó. */
  reason: DegradedOnuReason;
}

/** El alcance de una señal: nunca se mezcla un tenant con otro. */
export interface DegradedOnuScope {
  tenantId: string;
  connectionId: string;
}

/**
 * Cuánto vale una señal degradada.
 *
 * Un día: más que el intervalo del barrido FEC y lo bastante corto como para
 * que una ONU que se recuperó no quede en la cabeza para siempre.
 */
export const DEFAULT_DEGRADED_ONU_TTL_MS = 24 * 60 * 60 * 1_000;

/** Una entrada por scope, y una señal por ONU (la más reciente). */
const STATE = new Map<string, Map<string, DegradedOnuSignal>>();

function scopeKey(scope: DegradedOnuScope): string {
  return `${scope.tenantId}\u0000${scope.connectionId}`;
}

/**
 * Anota una ONU degradada.
 *
 * Una señal más vieja que la que ya está anotada no la pisa: los eventos pueden
 * llegar desordenados y el registro se queda con lo último que se supo.
 */
export function recordDegradedOnu(scope: DegradedOnuScope, signal: DegradedOnuSignal): void {
  const key = scopeKey(scope);
  let signals = STATE.get(key);
  if (signals === undefined) {
    signals = new Map();
    STATE.set(key, signals);
  }
  const current = signals.get(signal.onuId);
  if (current !== undefined && current.atMs > signal.atMs) return;
  signals.set(signal.onuId, signal);
}

/**
 * Las señales vigentes de un scope, ordenadas por id.
 *
 * El orden por id es el que hace determinista al resto: quien prioriza decide
 * el orden final, y dos consultas iguales devuelven lo mismo.
 */
export function snapshotDegradedOnus(
  scope: DegradedOnuScope,
  nowMs: number,
  ttlMs: number = DEFAULT_DEGRADED_ONU_TTL_MS,
): DegradedOnuSignal[] {
  const signals = STATE.get(scopeKey(scope));
  if (signals === undefined) return [];

  const vigentes: DegradedOnuSignal[] = [];
  for (const [onuId, signal] of signals) {
    if (nowMs - signal.atMs > ttlMs) {
      signals.delete(onuId);
      continue;
    }
    vigentes.push(signal);
  }
  if (signals.size === 0) STATE.delete(scopeKey(scope));

  return vigentes.sort((a, b) => (a.onuId < b.onuId ? -1 : a.onuId > b.onuId ? 1 : 0));
}

/** Sólo para tests: vacía el registro. */
export function __resetDegradedOnusForTests(): void {
  STATE.clear();
}
