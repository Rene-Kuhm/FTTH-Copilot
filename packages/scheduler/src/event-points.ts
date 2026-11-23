/**
 * De un evento de SmartOLT a las muestras de la base.
 *
 * El poll programado guarda estado y potencia con `collectSamples` +
 * `persistSamples` de `@ftth-copilot/analytics`. Un evento trae la misma
 * información, pero sólo de la ONU que cambió: acá se arma el mismo
 * `MetricPoint` (mismas `kind`, mismo `SampleMeta` con el `tenantId` de la
 * conexión) para que el sample viaje por el mismo camino y una serie temporal
 * no sepa si el dato vino de un poll o de un evento.
 *
 * Mapeo de potencias, según la especificación:
 *
 *   - `rx1310` es «la potencia que el OLT recibe de la ONU» (upstream → lo que
 *     la ONU transmite): `TX_POWER_DBM`.
 *   - `rx1490` es «la potencia que la ONU recibe del OLT» (downstream → lo que
 *     la ONU recibe): `RX_POWER_DBM`, el mismo campo que el inventario llama
 *     `signal`.
 *
 * Además de las muestras, devuelve las señales degradadas que el barrido FEC
 * usa para priorizar: un cambio de estado a LOS o Power fail, una caída de
 * señal de 2 dB o más, una banda de potencia mala y una lectura por debajo del
 * umbral de -27 dBm (el mismo umbral que usa el motor de detección).
 *
 * Función pura: no lee el reloj (recibe `nowMs` y `sampledAt`) y no toca la
 * base.
 */
import type { MetricPoint, SampleMeta } from '@ftth-copilot/analytics';
import type { SmartoltEventBatch } from '@ftth-copilot/connectors-smartolt';
import type { DegradedOnuReason, DegradedOnuSignal } from './degraded-onus';

/**
 * El umbral de recepción con problema, en dBm.
 *
 * Es el mismo que usan `@ftth-copilot/detection` y el motor de alertas
 * (`signal-drift.ts`, `agent-core/src/alerts.ts`): un solo número para toda la
 * plataforma.
 */
export const DEFAULT_DEGRADED_RX_THRESHOLD_DBM = -27;

/**
 * Las bandas de potencia que el proveedor usa para decir «esta ONU está mal».
 *
 * Los nombres vienen de los ejemplos oficiales (`Very good`, `Warning`). Una
 * banda desconocida no se marca: es preferible perder una prioridad a inventar
 * una degradación.
 */
const DEGRADED_BANDS = new Set(['warning', 'critical', 'bad', 'poor']);

/** Un cambio de potencia de esta magnitud ya es una degradación (2 dB). */
const DEGRADED_DELTA_DB = -2;

/** Lo que se puede pasar al mapeo. */
export interface OnuEventPointsOptions {
  /** Marca de tiempo de las muestras (ISO 8601), fija para todo el lote. */
  sampledAt: string;
  /** Epoch ms del procesamiento: la hora que se anota en la señal degradada. */
  nowMs: number;
  /** Umbral de recepción, en dBm. */
  thresholdDbm?: number;
}

/** El resultado: muestras para persistir y señales para el barrido FEC. */
export interface OnuEventPointsResult {
  points: MetricPoint[];
  degraded: DegradedOnuSignal[];
}

/** El id de la ONU en el inventario: el externo si vino, si no el serial. */
function rowId(row: Record<string, unknown>): string | undefined {
  for (const key of ['unique_external_id', 'sn']) {
    const value = row[key];
    if (typeof value === 'string' && value.length > 0) return value;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

/** Un número del evento, aceptando el string numérico. */
function rowNumber(row: Record<string, unknown>, key: string): number | undefined {
  const raw = row[key];
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const parsed = Number.parseFloat(raw.replace(',', '.'));
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

/** El estado del dominio, con el mismo criterio que el cliente del conector. */
function mapStatus(raw: unknown): 'online' | 'offline' | 'degraded' | undefined {
  if (typeof raw !== 'string' || raw.length === 0) return undefined;
  switch (raw.trim().toLowerCase()) {
    case 'online':
      return 'online';
    case 'offline':
      return 'offline';
    case 'los':
    case 'power fail':
    case 'unknown':
      return 'degraded';
    default:
      return 'degraded';
  }
}

function point(
  meta: SampleMeta,
  deviceId: string,
  kind: MetricPoint['kind'],
  sampledAt: string,
  value?: number,
  valueText?: string,
): MetricPoint {
  return {
    ...meta,
    deviceKind: 'ONU',
    deviceId,
    kind,
    ...(value === undefined ? {} : { value }),
    ...(valueText === undefined ? {} : { valueText }),
    sampledAt,
  };
}

/**
 * Traduce un lote de eventos de ONUs a muestras y señales degradadas.
 *
 * Los lotes de PON y de OLT no producen muestras de ONU: se devuelven vacíos y
 * el loop sólo los deja en el log.
 */
export function onuEventPoints(
  meta: SampleMeta,
  batch: SmartoltEventBatch,
  options: OnuEventPointsOptions,
): OnuEventPointsResult {
  if (batch.family !== 'onus') return { points: [], degraded: [] };

  const threshold = options.thresholdDbm ?? DEFAULT_DEGRADED_RX_THRESHOLD_DBM;
  const points: MetricPoint[] = [];
  const degraded: DegradedOnuSignal[] = [];

  const mark = (onuId: string, reason: DegradedOnuReason, rxPowerDbm?: number): void => {
    degraded.push({
      onuId,
      atMs: options.nowMs,
      reason,
      ...(rxPowerDbm === undefined ? {} : { rxPowerDbm }),
    });
  };

  for (const row of batch.rows) {
    const onuId = rowId(row);
    if (onuId === undefined) continue;

    switch (batch.type) {
      case 'onu.status_changed': {
        const status = mapStatus(row['status']);
        if (status === undefined) break;
        points.push(point(meta, onuId, 'STATUS', options.sampledAt, undefined, status));
        // Una ONU offline no tiene FEC que leer: esperar no cuesta presupuesto.
        if (status === 'degraded') mark(onuId, 'status_changed');
        break;
      }
      case 'onu.signal_changed': {
        const rx = rowNumber(row, 'rx1310');
        if (rx !== undefined) points.push(point(meta, onuId, 'TX_POWER_DBM', options.sampledAt, rx));
        const delta = rowNumber(row, 'delta');
        const band = typeof row['band'] === 'string' ? row['band'].trim().toLowerCase() : undefined;
        const worse = (delta !== undefined && delta <= DEGRADED_DELTA_DB)
          || (band !== undefined && DEGRADED_BANDS.has(band));
        if (worse) mark(onuId, 'signal_changed');
        break;
      }
      case 'onu.signal_reading': {
        const rx = rowNumber(row, 'rx1310');
        if (rx !== undefined) points.push(point(meta, onuId, 'TX_POWER_DBM', options.sampledAt, rx));
        const band = typeof row['band'] === 'string' ? row['band'].trim().toLowerCase() : undefined;
        if (band !== undefined && DEGRADED_BANDS.has(band)) mark(onuId, 'signal_reading');
        break;
      }
      case 'onu.rx1490_reading': {
        const rx = rowNumber(row, 'rx1490');
        if (rx === undefined) break;
        points.push(point(meta, onuId, 'RX_POWER_DBM', options.sampledAt, rx));
        if (rx <= threshold) mark(onuId, 'rx1490_reading', rx);
        break;
      }
      default:
        // authorized / updated / deleted / unconfigured: no hay muestra que
        // guardar (un alta o una baja no es una serie temporal).
        break;
    }
  }

  return { points, degraded };
}
