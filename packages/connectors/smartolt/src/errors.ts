import type { RateLimitError } from '@ftth-copilot/connectors-core';

/**
 * El motivo que da SmartOLT cuando corta una llamada por presupuesto.
 *
 * - `per_hour`: se gastó el presupuesto de la hora (1.000 por defecto).
 * - `per_10min`: la ventana de diez minutos.
 * - `per_second`: se pasó de 15 llamadas por segundo.
 * - `per_endpoint`: el endpoint tiene su propio límite (por ejemplo el export
 *   completo de ONUs, 15 por hora).
 */
export type SmartoltViolationType = 'per_hour' | 'per_10min' | 'per_second' | 'per_endpoint';

export interface SmartoltRateLimitErrorOptions {
  violationType?: SmartoltViolationType;
  retryAfterSeconds?: number;
  endpoint: string;
  attempts: number;
}

/**
 * El error tipado de un límite de llamadas.
 *
 * Implementa `RateLimitError` de `@ftth-copilot/connectors-core`, así que los
 * consumidores lo reconocen con `isRateLimitError` y pueden leer
 * `retryAfterSeconds` sin saber de qué NMS viene. La ruta del endpoint viaja en
 * el error; el `X-Token` nunca.
 */
export class SmartoltRateLimitError extends Error implements RateLimitError {
  readonly code = 'RATE_LIMIT' as const;
  readonly status = 429;
  readonly violationType?: SmartoltViolationType;
  readonly retryAfterSeconds?: number;
  readonly endpoint: string;
  readonly attempts: number;

  constructor(message: string, options: SmartoltRateLimitErrorOptions) {
    super(message);
    this.name = 'SmartoltRateLimitError';
    this.violationType = options.violationType;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.endpoint = options.endpoint;
    this.attempts = options.attempts;
  }
}

/**
 * Se cortó la paginación porque el resultado no entra en el tope de páginas.
 *
 * Es un error, no un resultado parcial: devolver medio inventario como si
 * fuera el inventario entero rompería cualquier cálculo de red que se apoye en
 * él. Si el parque creció, se sube `SMARTOLT_MAX_PAGES`.
 */
export class SmartoltPaginationLimitError extends Error {
  readonly code = 'PAGINATION_LIMIT' as const;
  readonly endpoint: string;
  readonly pagesFetched: number;
  readonly maxPages: number;
  readonly totalItems?: number;

  constructor(endpoint: string, pagesFetched: number, maxPages: number, totalItems?: number) {
    super(
      `SmartOLT paginó ${pagesFetched} páginas de ${endpoint} y no terminó` +
        (totalItems === undefined ? '' : ` (total_items: ${totalItems})`) +
        `. Se cortó en el tope de ${maxPages} páginas por llamada.`,
    );
    this.name = 'SmartoltPaginationLimitError';
    this.endpoint = endpoint;
    this.pagesFetched = pagesFetched;
    this.maxPages = maxPages;
    this.totalItems = totalItems;
  }
}

/**
 * La respuesta no tiene la forma que el conector sabe leer.
 *
 * El parseo ocurre en el borde: si SmartOLT cambia un campo que usamos, falla
 * acá con el detalle, en vez de propagar `undefined` hasta un cálculo de red.
 */
export class SmartoltResponseShapeError extends Error {
  readonly code = 'RESPONSE_SHAPE' as const;
  readonly endpoint: string;
  readonly issues: string[];

  constructor(endpoint: string, issues: string[]) {
    super(`SmartOLT devolvió una respuesta inesperada en ${endpoint}: ${issues.join('; ')}`);
    this.name = 'SmartoltResponseShapeError';
    this.endpoint = endpoint;
    this.issues = issues;
  }
}
