/**
 * Cliente de la paginación por cursor que exponen `/api/incidents` y
 * `/api/predictions`.
 *
 * La API devuelve una página por vez:
 *
 * ```json
 * { "incidents": [...], "count": 50,
 *   "page": { "scope": "unresolved", "hasMore": true, "nextCursor": "...", "total": 120 } }
 * ```
 *
 * Dos formas de consumarla, y cada consumidor necesita una:
 *
 * - **una lista que el operador recorre**: pide la primera página y sigue
 *   con el cursor. El botón de "cargar más" es el que le dice que hay más.
 * - **un conjunto que se usa para contar o para colorear**: recorre todas
 *   las páginas. Si se corta por el tope, el resultado lo dice, porque un
 *   conteo truncado en silencio es peor que ningún conteo.
 */

/** Metadatos de la página que devuelve la API. */
export interface PageMeta {
  /** Alcance de la consulta: `unresolved`, `resolved` o `all`. */
  scope: string;
  /** Si hay otra página después de esta. */
  hasMore: boolean;
  /** Cursor de la página siguiente, o `null` si no hay. */
  nextCursor: string | null;
  /** Cuántos hay en el scope, sin contar la paginación. */
  total: number;
}

/** Una página de items con sus metadatos. */
export interface Page<T> {
  items: T[];
  meta: PageMeta;
}

/** Metadatos por defecto: la API no los mandó, así que no se sabe nada. */
const EMPTY_META: PageMeta = {
  scope: 'unresolved',
  hasMore: false,
  nextCursor: null,
  total: 0,
};

/**
 * Lee la página de una respuesta cruda.
 *
 * Tolera una respuesta que no venga como se espera: una lista vacía y
 * metadatos vacíos son mejores que una excepción en el render.
 */
export function readPage<T>(body: unknown, key: string): Page<T> {
  const record = (body ?? {}) as Record<string, unknown>;
  const items = Array.isArray(record[key]) ? (record[key] as T[]) : [];
  const raw = record['page'];

  if (!raw || typeof raw !== 'object') {
    return { items, meta: { ...EMPTY_META, total: items.length } };
  }

  const meta = raw as Record<string, unknown>;
  const total = typeof meta['total'] === 'number' ? meta['total'] : items.length;

  return {
    items,
    meta: {
      scope: typeof meta['scope'] === 'string' ? meta['scope'] : EMPTY_META.scope,
      hasMore: meta['hasMore'] === true,
      nextCursor: typeof meta['nextCursor'] === 'string' ? meta['nextCursor'] : null,
      total,
    },
  };
}

/**
 * La URL de la página siguiente.
 *
 * Con `cursor` nulo devuelve la ruta tal cual: la primera página no lleva
 * cursor.
 */
export function nextPageUrl(path: string, cursor: string | null, limit?: number): string {
  if (!cursor) return path;
  const params = new URLSearchParams({ cursor });
  if (limit !== undefined) params.set('limit', String(limit));
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}${params.toString()}`;
}

/** Resultado de recorrer páginas. */
export interface AllPages<T> {
  items: T[];
  /** Total del scope, según la API. */
  total: number;
  /** Si se cortó el recorrido por el tope de páginas. */
  truncated: boolean;
  /** Cuántas páginas se trayeron. */
  pages: number;
}

/**
 * Recorre las páginas y concatena los items.
 *
 * `maxPages` es un tope **explícito**: el Caller tiene que decidir cuánto
 * está dispuesto a traer. Si el tope corta antes del final, `truncated` lo
 * dice, para que el consumidor pueda avisar en vez de mentir.
 */
export async function fetchAllPages<T>(
  fetchPage: (cursor: string | null) => Promise<Page<T>>,
  maxPages = 10,
): Promise<AllPages<T>> {
  const items: T[] = [];
  let cursor: string | null = null;
  let total = 0;
  let pages = 0;
  let truncated = false;

  for (let index = 0; index < maxPages; index += 1) {
    const page = await fetchPage(cursor);
    pages += 1;
    items.push(...page.items);
    total = page.meta.total;

    if (!page.meta.hasMore || !page.meta.nextCursor) break;
    if (index === maxPages - 1) {
      truncated = true;
      break;
    }
    cursor = page.meta.nextCursor;
  }

  return { items, total, truncated, pages };
}
