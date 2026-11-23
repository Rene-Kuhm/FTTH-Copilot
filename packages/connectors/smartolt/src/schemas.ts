import { SmartoltResponseShapeError } from './errors';

/**
 * El parseo del borde de SmartOLT.
 *
 * La API no publica JSON Schema por campo (sus respuestas están descriptas
 * como `{"type": "object"}`), así que el conector valida acá lo que realmente
 * consume: el sobre `status`, el array que lee y los campos numéricos de la
 * paginación. Los tests de contrato corren los ejemplos oficiales por estos
 * mismos parsers, de modo que un cambio de forma en el proveedor falla el CI
 * antes de llegar a un cálculo de red.
 */

/** El sobre mínimo de toda respuesta de SmartOLT. */
export interface SmartoltStatusEnvelope {
  status: boolean;
}

/** La lista de OLTs (`GET /api/system/get_olts`). */
export interface SmartoltOltsResponse {
  status: boolean;
  olts: Array<Record<string, unknown>>;
}

/** Una página de `GET /api/onu/get_all_onus_details`. */
export interface SmartoltOnusPage {
  status: boolean;
  page?: number;
  pageSize?: number;
  totalItems?: number;
  totalPages?: number;
  onus: Array<Record<string, unknown>>;
}

/** `GET /api/olt/get_olt_uptime_and_env_temperature/{olt_id}`. */
export interface SmartoltOltUptimeResponse {
  status: boolean;
  uptimeText?: string;
  uptimeSeconds?: number;
  temperatureCelsius?: number;
}

/** El endpoint por defecto que se reporta en el error de forma. */
const UNKNOWN_ENDPOINT = 'smartolt';

function asRecord(data: unknown, issues: string[], label: string): Record<string, unknown> {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    issues.push(`${label} no es un objeto`);
    return {};
  }
  return data as Record<string, unknown>;
}

function readStatus(record: Record<string, unknown>, issues: string[]): boolean {
  const status = record['status'];
  if (typeof status !== 'boolean') {
    issues.push('`status` no es booleano');
    return false;
  }
  return status;
}

/** Un entero del sobre, aceptando el string numérico que a veces manda la API. */
function readOptionalInt(
  record: Record<string, unknown>,
  key: string,
  issues: string[],
): number | undefined {
  const raw = record[key];
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' && /^\d+$/.test(raw.trim())) return Number.parseInt(raw.trim(), 10);
  issues.push(`\`${key}\` no es un número`);
  return undefined;
}

function readRows(
  record: Record<string, unknown>,
  key: string,
  issues: string[],
): Array<Record<string, unknown>> {
  const raw = record[key];
  if (!Array.isArray(raw)) {
    issues.push(`\`${key}\` no es un array`);
    return [];
  }
  const rows: Array<Record<string, unknown>> = [];
  for (const [index, row] of raw.entries()) {
    if (typeof row !== 'object' || row === null || Array.isArray(row)) {
      issues.push(`\`${key}[${index}]\` no es un objeto`);
      continue;
    }
    rows.push(row as Record<string, unknown>);
  }
  return rows;
}

function fail(issues: string[], endpoint: string): void {
  if (issues.length > 0) throw new SmartoltResponseShapeError(endpoint, issues);
}

/** El sobre `{ status }` de una respuesta cualquiera. */
export function parseStatusEnvelope(
  data: unknown,
  endpoint: string = UNKNOWN_ENDPOINT,
): SmartoltStatusEnvelope {
  const issues: string[] = [];
  const record = asRecord(data, issues, 'la respuesta');
  const status = readStatus(record, issues);
  fail(issues, endpoint);
  return { status };
}

/** `{ status, response: [ { id, name, ip, ... } ] }` de la lista de OLTs. */
export function parseOltsResponse(
  data: unknown,
  endpoint: string = UNKNOWN_ENDPOINT,
): SmartoltOltsResponse {
  const issues: string[] = [];
  const record = asRecord(data, issues, 'la respuesta');
  const status = readStatus(record, issues);
  const olts = readRows(record, 'response', issues);
  fail(issues, endpoint);
  return { status, olts };
}

/**
 * Una página del inventario de ONUs.
 *
 * Acepta también el export completo (sin campos de paginación): es la misma
 * forma con `onus` y sin sobre. El cliente nunca lo pide, pero el mock NMS lo
 * sigue sirviendo y el parser no tiene por qué romper.
 */
export function parseOnusPageResponse(
  data: unknown,
  endpoint: string = UNKNOWN_ENDPOINT,
): SmartoltOnusPage {
  const issues: string[] = [];
  const record = asRecord(data, issues, 'la respuesta');
  const status = readStatus(record, issues);
  const onus = readRows(record, 'onus', issues);
  const page = readOptionalInt(record, 'page', issues);
  const pageSize = readOptionalInt(record, 'page_size', issues);
  const totalItems = readOptionalInt(record, 'total_items', issues);
  const totalPages = readOptionalInt(record, 'total_pages', issues);
  fail(issues, endpoint);

  return {
    status,
    onus,
    ...(page === undefined ? {} : { page }),
    ...(pageSize === undefined ? {} : { pageSize }),
    ...(totalItems === undefined ? {} : { totalItems }),
    ...(totalPages === undefined ? {} : { totalPages }),
  };
}

/**
 * Uptime y temperatura ambiente de un OLT.
 *
 * La API los devuelve como texto (`"576 days, 21:05"`, `"24°C"`), así que el
 * parser los convierte a las unidades del dominio y deja `undefined` cuando el
 * OLT no contestó en vez de inventar un cero.
 */
export function parseOltUptimeResponse(
  data: unknown,
  endpoint: string = UNKNOWN_ENDPOINT,
): SmartoltOltUptimeResponse {
  const issues: string[] = [];
  const record = asRecord(data, issues, 'la respuesta');
  const status = readStatus(record, issues);

  const rawUptime = record['uptime'];
  if (rawUptime !== undefined && typeof rawUptime !== 'string') {
    issues.push('`uptime` no es texto');
  }
  const rawTemperature = record['env_temp'];
  if (rawTemperature !== undefined && typeof rawTemperature !== 'string') {
    issues.push('`env_temp` no es texto');
  }
  fail(issues, endpoint);

  const uptimeText = typeof rawUptime === 'string' ? rawUptime : undefined;
  const uptimeSeconds = parseUptimeText(uptimeText);
  const temperatureCelsius =
    typeof rawTemperature === 'string' ? parseTemperatureText(rawTemperature) : undefined;

  return {
    status,
    ...(uptimeText === undefined ? {} : { uptimeText }),
    ...(uptimeSeconds === undefined ? {} : { uptimeSeconds }),
    ...(temperatureCelsius === undefined ? {} : { temperatureCelsius }),
  };
}

/**
 * Convierte `"576 days, 21:05"` a segundos.
 *
 * Devuelve `undefined` para `"N/A"` y para cualquier texto que no se entienda:
 * un uptime inventado es peor que un uptime ausente.
 */
export function parseUptimeText(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const match = /^(?:(\d+)\s+days?,\s*)?(\d+):(\d{2})(?::(\d{2}))?$/.exec(raw.trim());
  if (!match) return undefined;

  const days = match[1] === undefined ? 0 : Number.parseInt(match[1], 10);
  const hours = Number.parseInt(match[2] ?? '0', 10);
  const minutes = Number.parseInt(match[3] ?? '0', 10);
  const seconds = match[4] === undefined ? 0 : Number.parseInt(match[4], 10);
  return days * 86_400 + hours * 3_600 + minutes * 60 + seconds;
}

/** Convierte `"24°C"` a 24. Devuelve `undefined` si el texto no trae un número. */
export function parseTemperatureText(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const match = /(-?\d+(?:[.,]\d+)?)\s*(?:°\s*C)?/i.exec(raw.trim());
  if (!match || match[1] === undefined) return undefined;
  const value = Number.parseFloat(match[1].replace(',', '.'));
  return Number.isFinite(value) ? value : undefined;
}

/** El endpoint del stream de eventos, el que reporta el error de forma. */
export const EVENT_STREAM_ENDPOINT = '/api/onu/get_event_stream';

/**
 * Los tipos de evento que publica la especificación de octubre 2026.
 *
 * Son los mismos para el stream (SSE) y para el webhook: cambia el transporte,
 * no el cuerpo. Un tipo que no esté en esta lista es un error del pedido (400),
 * así que la lista funciona también como validación del borde.
 */
export const SMARTOLT_EVENT_TYPES = [
  'onu.status_changed',
  'onu.authorized',
  'onu.updated',
  'onu.deleted',
  'onu.signal_changed',
  'onu.signal_reading',
  'onu.rx1490_reading',
  'onu.unconfigured_detected',
  'pon.outage_started',
  'pon.outage_ended',
  'olt.status_stale',
  'olt.status_fresh',
] as const;

export type SmartoltEventType = (typeof SMARTOLT_EVENT_TYPES)[number];

/** Dónde vienen las filas del evento: `data.onus`, `data.pons` o `data.olts`. */
export type SmartoltEventFamily = 'onus' | 'pons' | 'olts';

/** El tope de filas por lote que publica el proveedor. */
export const SMARTOLT_MAX_EVENT_ROWS = 1_000;

/** El vencimiento por defecto de la URL del stream, en segundos. */
export const DEFAULT_EVENT_STREAM_EXPIRES_IN_SECONDS = 900;

/** El sobre de `GET /api/onu/get_event_stream`. */
export interface SmartoltEventStreamUrl {
  status: boolean;
  url: string;
  expiresInSeconds: number;
}

/** Un lote de eventos ya validado. */
export interface SmartoltEventBatch {
  type: SmartoltEventType;
  timestamp?: string;
  family: SmartoltEventFamily;
  rows: Array<Record<string, unknown>>;
}

/**
 * Lo que cada tipo de evento tiene que traer para que el conector lo consuma.
 *
 * La API describe las respuestas como objetos libres, así que el contrato real
 * es el ejemplo publicado. Estas son exactamente las columnas que el conector
 * lee: un cambio de nombre en el proveedor falla acá, en el borde, y no en un
 * cálculo de red.
 */
const EVENT_ROW_SPEC: Record<
  SmartoltEventType,
  { family: SmartoltEventFamily; required: readonly string[]; numeric?: readonly string[] }
> = {
  'onu.status_changed': { family: 'onus', required: ['status'] },
  'onu.authorized': { family: 'onus', required: ['sn'] },
  'onu.updated': { family: 'onus', required: ['sn'] },
  'onu.deleted': { family: 'onus', required: ['sn'] },
  'onu.signal_changed': { family: 'onus', required: ['rx1310'], numeric: ['rx1310'] },
  'onu.signal_reading': {
    family: 'onus',
    required: ['rx1310', 'reading_at'],
    numeric: ['rx1310'],
  },
  'onu.rx1490_reading': {
    family: 'onus',
    required: ['rx1490', 'reading_at'],
    numeric: ['rx1490'],
  },
  'onu.unconfigured_detected': { family: 'onus', required: ['sn', 'olt_id'] },
  'pon.outage_started': { family: 'pons', required: ['olt_id', 'board', 'port'] },
  'pon.outage_ended': { family: 'pons', required: ['olt_id', 'board', 'port'] },
  'olt.status_stale': { family: 'olts', required: ['olt_id'] },
  'olt.status_fresh': { family: 'olts', required: ['olt_id'] },
};

/** Si el valor es un tipo de evento que la especificación publica. */
export function isSmartoltEventType(value: unknown): value is SmartoltEventType {
  return typeof value === 'string' && (SMARTOLT_EVENT_TYPES as readonly string[]).includes(value);
}

/** Un número finito, aceptando el string numérico que manda algún firmware. */
function readNumber(raw: unknown): number | undefined {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' && /^-?\d+(?:[.,]\d+)?$/.test(raw.trim())) {
    const parsed = Number.parseFloat(raw.trim().replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

/**
 * `{ status: true, response: { url, expires_in } }` del pedido del stream.
 *
 * Sin `expires_in` se asume el minuto y medio que publica el ejemplo: abrir la
 * URL vencida es peor que pedir otra un rato antes.
 */
export function parseEventStreamResponse(
  data: unknown,
  endpoint: string = EVENT_STREAM_ENDPOINT,
): SmartoltEventStreamUrl {
  const issues: string[] = [];
  const record = asRecord(data, issues, 'la respuesta');
  const status = readStatus(record, issues);
  const response = asRecord(record['response'], issues, '`response`');
  const url = response['url'];
  if (typeof url !== 'string' || url.length === 0) {
    issues.push('`response.url` falta o no es texto');
  }
  const expiresIn = readOptionalInt(response, 'expires_in', issues);
  fail(issues, endpoint);

  return {
    status,
    url: typeof url === 'string' ? url : '',
    expiresInSeconds:
      expiresIn !== undefined && expiresIn > 0
        ? expiresIn
        : DEFAULT_EVENT_STREAM_EXPIRES_IN_SECONDS,
  };
}

/**
 * El cuerpo de un evento, desde el `data` crudo del frame SSE.
 *
 * El `data` de un frame SSE puede venir partido en varias líneas `data:` (el
 * parser las une con `\n`), así que acá se parsea JSON y se valida la forma.
 */
export function parseSmartoltEventData(
  raw: string,
  endpoint: string = EVENT_STREAM_ENDPOINT,
): SmartoltEventBatch {
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new SmartoltResponseShapeError(endpoint, ['`data` no es JSON']);
  }
  return parseSmartoltEventBatch(payload, endpoint);
}

/**
 * Valida el cuerpo de un evento: el tipo, la familia de filas y las columnas
 * que el conector consume de cada fila.
 */
export function parseSmartoltEventBatch(
  payload: unknown,
  endpoint: string = EVENT_STREAM_ENDPOINT,
): SmartoltEventBatch {
  const issues: string[] = [];
  const record = asRecord(payload, issues, 'el evento');

  const rawType = record['type'];
  if (typeof rawType !== 'string') {
    issues.push('`type` no es texto');
  } else if (!isSmartoltEventType(rawType)) {
    issues.push(
      `el tipo de evento "${rawType}" no es uno que la especificación publique`,
    );
  }

  const rawTimestamp = record['timestamp'];
  if (rawTimestamp !== undefined && typeof rawTimestamp !== 'string') {
    issues.push('`timestamp` no es texto');
  }

  if (record['data'] === undefined || record['data'] === null) {
    issues.push('`data` falta');
  }

  // El tipo y la familia son la base de todo lo demás: sin ellos no hay nada
  // que validar fila por fila.
  fail(issues, endpoint);

  const type = rawType as SmartoltEventType;
  const spec = EVENT_ROW_SPEC[type];
  const data = asRecord(record['data'], issues, '`data`');
  const rows = readRows(data, spec.family, issues);

  if (rows.length > SMARTOLT_MAX_EVENT_ROWS) {
    issues.push(
      `\`${spec.family}\` trae ${rows.length} filas y el tope del proveedor es ${SMARTOLT_MAX_EVENT_ROWS}`,
    );
  }

  for (const [index, row] of rows.entries()) {
    for (const field of spec.required) {
      const value = row[field];
      if (value === undefined || value === null || value === '') {
        issues.push(`\`${spec.family}[${index}].${field}\` falta`);
      }
    }
    for (const field of spec.numeric ?? []) {
      const value = row[field];
      if (value === undefined || value === null) continue;
      if (readNumber(value) === undefined) {
        issues.push(`\`${spec.family}[${index}].${field}\` no es un número`);
      }
    }
  }

  fail(issues, endpoint);

  return {
    type,
    ...(typeof rawTimestamp === 'string' ? { timestamp: rawTimestamp } : {}),
    family: spec.family,
    rows,
  };
}
