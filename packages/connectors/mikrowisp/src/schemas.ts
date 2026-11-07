/**
 * El parseo del borde de Mikrowisp.
 *
 * La API contesta siempre el mismo sobre (`estado`/`code`/`mensaje`) y, según
 * el endpoint, un array con nombre propio (`routers`, `equipos`, `clientes`,
 * `odbs`). Estos parsers validan ese sobre y que las filas sean objetos, que
 * es exactamente lo que el conector consume. Los tests de contrato corren los
 * ejemplos oficiales por acá, así que un cambio de forma en el proveedor falla
 * el CI antes de tocar un cálculo de red.
 */

/** El error de forma de una respuesta de Mikrowisp. */
export class MikrowispResponseShapeError extends Error {
  readonly code = 'RESPONSE_SHAPE' as const;
  readonly endpoint: string;
  readonly issues: string[];

  constructor(endpoint: string, issues: string[]) {
    super(`Mikrowisp devolvió una respuesta inesperada en ${endpoint}: ${issues.join('; ')}`);
    this.name = 'MikrowispResponseShapeError';
    this.endpoint = endpoint;
    this.issues = issues;
  }
}

/** El sobre común de toda respuesta. */
export interface MikrowispEnvelope {
  /** `exito` cuando salió bien; cualquier otra cosa es un error del proveedor. */
  estado?: string;
  /** El código de la respuesta, normalizado a texto (`'200'`). */
  code?: string;
  mensaje?: string;
}

export interface MikrowispRoutersResponse extends MikrowispEnvelope {
  routers: Array<Record<string, unknown>>;
}

export interface MikrowispMonitoreoResponse extends MikrowispEnvelope {
  equipos: Array<Record<string, unknown>>;
}

export interface MikrowispClientesResponse extends MikrowispEnvelope {
  clientes: Array<Record<string, unknown>>;
}

export interface MikrowispOdbsResponse extends MikrowispEnvelope {
  odbs: Array<Record<string, unknown>>;
}

const UNKNOWN_ENDPOINT = 'mikrowisp';

function asRecord(data: unknown, issues: string[]): Record<string, unknown> {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    issues.push('la respuesta no es un objeto');
    return {};
  }
  return data as Record<string, unknown>;
}

function readOptionalString(
  record: Record<string, unknown>,
  key: string,
  issues: string[],
): string | undefined {
  const raw = record[key];
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  issues.push(`\`${key}\` no es texto`);
  return undefined;
}

function readRows(
  record: Record<string, unknown>,
  key: string,
  issues: string[],
): Array<Record<string, unknown>> {
  const raw = record[key];
  if (raw === undefined || raw === null) return [];
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

function parseEnvelope(
  data: unknown,
  endpoint: string,
): { envelope: MikrowispEnvelope; record: Record<string, unknown> } {
  const issues: string[] = [];
  const record = asRecord(data, issues);
  const estado = readOptionalString(record, 'estado', issues);
  const code = readOptionalString(record, 'code', issues);
  const mensaje = readOptionalString(record, 'mensaje', issues);
  if (issues.length > 0) throw new MikrowispResponseShapeError(endpoint, issues);
  return {
    envelope: {
      ...(estado === undefined ? {} : { estado }),
      ...(code === undefined ? {} : { code }),
      ...(mensaje === undefined ? {} : { mensaje }),
    },
    record,
  };
}

function parseRowsResponse<T extends MikrowispEnvelope>(
  data: unknown,
  key: string,
  endpoint: string,
): T {
  const { envelope, record } = parseEnvelope(data, endpoint);
  const issues: string[] = [];
  const rows = readRows(record, key, issues);
  if (issues.length > 0) throw new MikrowispResponseShapeError(endpoint, issues);
  return { ...envelope, [key]: rows } as T;
}

/** `GET/POST /GetRouters` → `{ estado, routers }`. */
export function parseMikrowispRouters(
  data: unknown,
  endpoint: string = UNKNOWN_ENDPOINT,
): MikrowispRoutersResponse {
  return parseRowsResponse<MikrowispRoutersResponse>(data, 'routers', endpoint);
}

/** `/GetMonitoreo` → `{ estado, equipos }`. */
export function parseMikrowispMonitoreo(
  data: unknown,
  endpoint: string = UNKNOWN_ENDPOINT,
): MikrowispMonitoreoResponse {
  return parseRowsResponse<MikrowispMonitoreoResponse>(data, 'equipos', endpoint);
}

/** `/GetAllClients` → `{ estado, clientes }`. */
export function parseMikrowispClientes(
  data: unknown,
  endpoint: string = UNKNOWN_ENDPOINT,
): MikrowispClientesResponse {
  return parseRowsResponse<MikrowispClientesResponse>(data, 'clientes', endpoint);
}

/** `/SmartOltGetODB` → `{ code, mensaje, odbs }` (sin `estado`). */
export function parseMikrowispOdbs(
  data: unknown,
  endpoint: string = UNKNOWN_ENDPOINT,
): MikrowispOdbsResponse {
  return parseRowsResponse<MikrowispOdbsResponse>(data, 'odbs', endpoint);
}
