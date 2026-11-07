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
