/**
 * Paginación de `get_all_onus_details` (S3).
 *
 * Sin `page`, ese endpoint es un export completo del inventario: 15 llamadas
 * por hora y bloqueo al llegar al límite. Con `page` + `page_size` cuenta
 * contra el presupuesto general (1.000/h), así que el conector pagina siempre,
 * opcionalmente de forma incremental (`updated_since`) y con un tope de páginas
 * por llamada para que un `total_items` absurdo no lo deje girando.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SMARTOLT_MAX_PAGES,
  SmartOltClient,
  formatUpdatedSince,
  resolveSmartoltMaxPages,
} from '../src/client';
import { SmartoltPaginationLimitError, SmartoltResponseShapeError } from '../src/errors';

const API_BASE = 'https://demo.smartolt.com';
const API_KEY = 'sk-secret-token-1234';

function onuRow(index: number): Record<string, unknown> {
  return {
    unique_external_id: `ONU-${String(index).padStart(4, '0')}`,
    sn: `HWTC${String(index).padStart(8, '0')}`,
    olt_id: '1',
    board: '1',
    port: '1',
    onu: String(index),
    onu_type_name: 'Huawei-HG8145V5',
    name: `Cliente ${index}`,
    status: 'Online',
    signal: '-19.5',
  };
}

interface PagedFetchOptions {
  pageSize: number;
  totalItems: number;
  totalPages?: number;
}

/** Un SmartOLT de mentira que pagina de verdad y anota cada URL pedida. */
function pagedFetch(options: PagedFetchOptions): { fetchImpl: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const inventory = Array.from({ length: options.totalItems }, (_unused, index) => onuRow(index));

  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const raw = typeof input === 'string' ? input : input.toString();
    calls.push(raw);
    const url = new URL(raw);
    const page = Number.parseInt(url.searchParams.get('page') ?? '1', 10);
    const pageSize = Number.parseInt(url.searchParams.get('page_size') ?? '100', 10);

    // Los filtros que el conector manda se aplican del lado del servidor, como
    // en la API real.
    const externalId = url.searchParams.get('external_id');
    const sn = url.searchParams.get('sn');
    const name = url.searchParams.get('name');
    const matching = inventory.filter(
      (row) =>
        (externalId === null || row['unique_external_id'] === externalId) &&
        (sn === null || row['sn'] === sn) &&
        (name === null || String(row['name']).includes(name)),
    );

    const start = (page - 1) * pageSize;
    const onus = matching.slice(start, start + pageSize);

    return new Response(
      JSON.stringify({
        status: true,
        page,
        page_size: pageSize,
        total_items: matching.length,
        total_pages: options.totalPages ?? Math.ceil(matching.length / pageSize),
        onus,
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function newClient(fetchImpl: typeof fetch, extra: { maxPages?: number; env?: NodeJS.ProcessEnv } = {}): SmartOltClient {
  return new SmartOltClient({
    useMock: false,
    apiKey: API_KEY,
    apiBaseUrl: API_BASE,
    fetchImpl,
    rateLimit: { perHour: 1_000, perSecond: 15 },
    ...extra,
  });
}

describe('la paginación de ONUs', () => {
  it('recorre las páginas hasta cubrir total_items', async () => {
    const { fetchImpl, calls } = pagedFetch({ pageSize: 100, totalItems: 250 });

    const onus = await newClient(fetchImpl).listOnus();

    expect(onus).toHaveLength(250);
    expect(onus[0]?.id).toBe('ONU-0000');
    expect(onus[249]?.id).toBe('ONU-0249');
    expect(calls).toHaveLength(3);
    expect(calls[0]).toContain('page=1');
    expect(calls[0]).toContain('page_size=100');
    expect(calls[1]).toContain('page=2');
    expect(calls[2]).toContain('page=3');
  });

  it('nunca pide el export completo sin page', async () => {
    const { fetchImpl, calls } = pagedFetch({ pageSize: 100, totalItems: 120 });

    await newClient(fetchImpl).listOnus();

    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(new URL(call).searchParams.get('page')).not.toBeNull();
    }
  });

  it('pide una página y corta cuando total_items cabe en ella', async () => {
    const { fetchImpl, calls } = pagedFetch({ pageSize: 100, totalItems: 7 });

    const onus = await newClient(fetchImpl).listOnus();

    expect(onus).toHaveLength(7);
    expect(calls).toHaveLength(1);
  });

  it('manda updated_since para la sincronización incremental', async () => {
    const { fetchImpl, calls } = pagedFetch({ pageSize: 100, totalItems: 1 });

    await newClient(fetchImpl).listOnus(undefined, { updatedSince: '2026-07-08 12:00:00' });

    expect(calls[0]).toContain('updated_since=2026-07-08+12%3A00%3A00');
  });

  it('manda olt_id cuando se filtra por OLT', async () => {
    const { fetchImpl, calls } = pagedFetch({ pageSize: 100, totalItems: 1 });

    await newClient(fetchImpl).listOnus({ oltId: '53' });

    expect(calls[0]).toContain('olt_id=53');
  });

  it('falla en vez de truncar cuando una página llega vacía antes de total_items', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === 'string' ? input : input.toString());
      calls.push(url.toString());
      const page = Number.parseInt(url.searchParams.get('page') ?? '1', 10);
      const onus = page === 1 ? Array.from({ length: 100 }, (_unused, index) => onuRow(index)) : [];
      return new Response(
        JSON.stringify({ status: true, page, page_size: 100, total_items: 250, total_pages: 3, onus }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const error = await newClient(fetchImpl)
      .listOnus()
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SmartoltResponseShapeError);
    expect((error as SmartoltResponseShapeError).code).toBe('RESPONSE_SHAPE');
    expect((error as SmartoltResponseShapeError).message).toContain('100 de 250');
    expect((error as SmartoltResponseShapeError).message).not.toContain(API_KEY);
    expect(calls).toHaveLength(2);
  });

  it('corta con un error tipado cuando supera el tope de páginas', async () => {
    const { fetchImpl, calls } = pagedFetch({ pageSize: 100, totalItems: 10_000 });

    const error = await newClient(fetchImpl, { maxPages: 3 })
      .listOnus()
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SmartoltPaginationLimitError);
    expect((error as SmartoltPaginationLimitError).code).toBe('PAGINATION_LIMIT');
    expect((error as SmartoltPaginationLimitError).pagesFetched).toBe(3);
    expect(calls).toHaveLength(3);
  });

  it('deja configurar el tope de páginas por entorno', () => {
    expect(DEFAULT_SMARTOLT_MAX_PAGES).toBe(50);
    expect(resolveSmartoltMaxPages({ SMARTOLT_MAX_PAGES: '2' })).toBe(2);
    expect(resolveSmartoltMaxPages({})).toBe(DEFAULT_SMARTOLT_MAX_PAGES);
    expect(resolveSmartoltMaxPages({ SMARTOLT_MAX_PAGES: 'no-es-un-numero' })).toBe(
      DEFAULT_SMARTOLT_MAX_PAGES,
    );
    expect(resolveSmartoltMaxPages({ SMARTOLT_MAX_PAGES: '0' })).toBe(DEFAULT_SMARTOLT_MAX_PAGES);
  });

  it('usa el tope de páginas del entorno cuando no hay opción', async () => {
    const { fetchImpl, calls } = pagedFetch({ pageSize: 100, totalItems: 10_000 });

    const error = await newClient(fetchImpl, { env: { SMARTOLT_MAX_PAGES: '2' } })
      .listOnus()
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SmartoltPaginationLimitError);
    expect(calls).toHaveLength(2);
  });

  it('escribe updated_since con el formato que pide la API', () => {
    expect(formatUpdatedSince(new Date('2026-07-08T12:00:00Z'))).toBe('2026-07-08 12:00:00');
  });

  it('busca el detalle de una ONU por external_id sin bajar el inventario entero', async () => {
    const { fetchImpl, calls } = pagedFetch({ pageSize: 100, totalItems: 250 });

    const detail = await newClient(fetchImpl).getOnuDetail('ONU-0249');

    expect(detail?.id).toBe('ONU-0249');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('external_id=ONU-0249');
  });
});
