/**
 * Tests de contrato de SmartOLT (S4).
 *
 * Corren offline contra `contract/smartolt-openapi.subset.json`, que es un
 * subconjunto de la especificación oficial generado por
 * `scripts/sync-contract.ts`. Cubren las dos mitades del contrato:
 *
 *   1. Lo que el cliente pide: cada ruta y cada query que manda existe y está
 *      declarada en la especificación. Un endpoint nuevo en el cliente rompe
 *      este test, que es lo que tiene que pasar.
 *   2. Lo que el cliente espera recibir: los ejemplos oficiales (y las
 *      respuestas del mock NMS) parsean con los esquemas del cliente.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { SmartOltClient } from '../src/client';
import { smartoltMockResponse } from '../src/mock-nms';
import {
  parseOltUptimeResponse,
  parseOltsResponse,
  parseOnusPageResponse,
  parseStatusEnvelope,
} from '../src/schemas';

const SUBSET_URL = new URL('../contract/smartolt-openapi.subset.json', import.meta.url);

interface SubsetParameter {
  name: string;
  in: string;
  required?: boolean;
}

interface SubsetOperation {
  parameters?: SubsetParameter[];
  responses?: Record<string, unknown>;
}

interface Subset {
  provenance: {
    sourceUrl: string;
    retrievedAt: string;
    subset: boolean;
    openapi: string | null;
    pathPatterns: string[];
    note: string;
  };
  paths: Record<string, { get?: SubsetOperation }>;
}

function loadSubset(): Subset {
  return JSON.parse(readFileSync(SUBSET_URL, 'utf8')) as Subset;
}

/** Los endpoints que el cliente llama. Si el cliente suma uno, esto se actualiza. */
const CLIENT_ENDPOINTS = [
  '/api/system/get_zones',
  '/api/system/get_olts',
  '/api/onu/get_all_onus_details',
  '/api/olt/get_olt_uptime_and_env_temperature/{olt_id}',
] as const;

/** Compara un pathname contra un path de la especificación (`{param}` incluidos). */
function matchesSpecPath(specPath: string, pathname: string): boolean {
  const specSegments = specPath.split('/');
  const actualSegments = pathname.split('/');
  if (specSegments.length !== actualSegments.length) return false;
  return specSegments.every(
    (segment, index) =>
      (segment.startsWith('{') && segment.endsWith('}')) || segment === actualSegments[index],
  );
}

interface ExampleEntry {
  value: unknown;
}

/** El primer ejemplo 200 de una operación, o `undefined` si no publica ejemplos. */
function examplesOf(operation: SubsetOperation | undefined): unknown[] {
  const responses = operation?.responses ?? {};
  const ok = responses['200'] as
    | { content?: Record<string, { example?: unknown; examples?: Record<string, ExampleEntry> }> }
    | undefined;
  const json = ok?.content?.['application/json'];
  if (!json) return [];
  const named = json.examples ? Object.values(json.examples).map((entry) => entry.value) : [];
  return json.example === undefined ? named : [json.example, ...named];
}

/**
 * Un SmartOLT de mentira armado desde la especificación.
 *
 * Resuelve el pathname contra el subconjunto y falla si no existe; valida que
 * cada query esté declarada en `parameters`; devuelve el ejemplo oficial. Es
 * decir, cualquier ruta o parámetro que el cliente invente rompe el test.
 */
function specFetch(subset: Subset): { fetchImpl: typeof fetch; requests: string[] } {
  const requests: string[] = [];

  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const raw = typeof input === 'string' ? input : input.toString();
    requests.push(raw);
    const url = new URL(raw);

    const specPath = Object.keys(subset.paths).find((candidate) =>
      matchesSpecPath(candidate, url.pathname),
    );
    if (!specPath) {
      throw new Error(`El cliente pidió ${url.pathname}, que no está en el contrato`);
    }
    const operation = subset.paths[specPath]?.get;
    if (!operation) {
      throw new Error(`El contrato no describe un GET para ${specPath}`);
    }

    const declaredQuery = new Set(
      (operation.parameters ?? []).filter((p) => p.in === 'query').map((p) => p.name),
    );
    for (const key of url.searchParams.keys()) {
      if (!declaredQuery.has(key)) {
        throw new Error(
          `El cliente mandó "${key}" a ${specPath}, que no declara ese query param`,
        );
      }
    }

    const examples = examplesOf(operation);
    const example = examples.find((candidate) => candidate !== undefined) as
      | Record<string, unknown>
      | undefined;
    if (!example) throw new Error(`El contrato no publica ejemplo 200 para ${specPath}`);

    // La especificación publica dos ejemplos para el listado de ONUs (export
    // completo y paginado). Se elige según lo que pidió el cliente y se ajusta
    // el sobre a la página concreta, sin inventar campos.
    if (url.searchParams.has('page') && Array.isArray(example['onus'])) {
      const onus = example['onus'] as unknown[];
      const pageSize = Number.parseInt(url.searchParams.get('page_size') ?? '100', 10);
      return jsonResponse({
        ...example,
        page: Number.parseInt(url.searchParams.get('page') ?? '1', 10),
        page_size: pageSize,
        total_items: onus.length,
        total_pages: 1,
      });
    }

    return jsonResponse(example);
  }) as unknown as typeof fetch;

  return { fetchImpl, requests };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function newClient(fetchImpl: typeof fetch): SmartOltClient {
  return new SmartOltClient({
    useMock: false,
    apiKey: 'sk-contract-test',
    apiBaseUrl: 'https://demo.smartolt.com',
    fetchImpl,
    rateLimit: { perHour: 1_000, perSecond: 15 },
  });
}

describe('el contrato de SmartOLT', () => {
  const subset = loadSubset();

  it('registra de dónde salió y que es un subconjunto', () => {
    expect(subset.provenance.subset).toBe(true);
    expect(subset.provenance.sourceUrl).toBe('https://www.smartolt.com/openapi.json');
    expect(subset.provenance.retrievedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(subset.provenance.openapi).toBe('3.0.3');
    expect(subset.provenance.pathPatterns.length).toBeGreaterThan(0);
    expect(subset.provenance.note).toMatch(/tests de contrato/i);
  });

  it('incluye exactamente los endpoints que el cliente llama', () => {
    expect(Object.keys(subset.paths).sort()).toEqual([...CLIENT_ENDPOINTS].sort());
  });

  it('mantiene los endpoints del cliente en el subconjunto', () => {
    for (const endpoint of CLIENT_ENDPOINTS) {
      expect(subset.paths[endpoint], `falta ${endpoint}`).toBeDefined();
    }
  });
});

describe('lo que el cliente pide', () => {
  const subset = loadSubset();

  it('ping no usa get_olts como heartbeat', async () => {
    const { fetchImpl, requests } = specFetch(subset);

    const result = await newClient(fetchImpl).ping();

    expect(result.ok).toBe(true);
    expect(requests).toHaveLength(1);
    expect(new URL(requests[0] ?? '').pathname).toBe('/api/system/get_zones');
  });

  it('listOlts, getOltDetail y los listados sólo tocan rutas y queries del contrato', async () => {
    const { fetchImpl, requests } = specFetch(subset);
    const client = newClient(fetchImpl);

    await client.listOlts();
    const detail = await client.getOltDetail('53');
    const onus = await client.listOnus({ oltId: '53' }, { updatedSince: '2026-07-08 12:00:00' });
    const overview = await client.getNetworkOverview();
    await client.getOnusWithLowSignal(-27);
    await client.searchByCustomerName('test');
    await client.getOnuDetail('HWTC12341234');

    expect(detail.id).toBe('53');
    expect(onus.length).toBeGreaterThan(0);
    expect(overview.totalOnus).toBeGreaterThan(0);

    // specFetch falla si una ruta o un query no está en el contrato: llegar
    // hasta acá ya es la aserción. Igual se deja explícito el inventario.
    const touched = new Set(requests.map((request) => new URL(request).pathname));
    expect([...touched].sort()).toEqual([
      '/api/olt/get_olt_uptime_and_env_temperature/53',
      '/api/onu/get_all_onus_details',
      '/api/system/get_olts',
    ]);
  });
});

describe('lo que el cliente espera recibir', () => {
  const subset = loadSubset();

  it('parsea el ejemplo de get_olts', () => {
    const example = examplesOf(subset.paths['/api/system/get_olts']?.get)[0];

    const parsed = parseOltsResponse(example);

    expect(parsed.status).toBe(true);
    expect(parsed.olts[0]?.['id']).toBe('1');
  });

  it('parsea los dos ejemplos de get_all_onus_details (export y paginado)', () => {
    const examples = examplesOf(subset.paths['/api/onu/get_all_onus_details']?.get);

    expect(examples.length).toBeGreaterThanOrEqual(2);
    for (const example of examples) {
      const parsed = parseOnusPageResponse(example);
      expect(parsed.status).toBe(true);
      expect(parsed.onus.length).toBeGreaterThan(0);
      expect(parsed.onus[0]?.['unique_external_id']).toBeDefined();
    }
  });

  it('parsea el ejemplo de uptime y temperatura del OLT', () => {
    const example = examplesOf(
      subset.paths['/api/olt/get_olt_uptime_and_env_temperature/{olt_id}']?.get,
    )[0];

    const parsed = parseOltUptimeResponse(example);

    expect(parsed.status).toBe(true);
    expect(parsed.temperatureCelsius).toBe(24);
    expect(parsed.uptimeSeconds).toBeGreaterThan(0);
  });

  it('parsea el ejemplo de get_zones', () => {
    const example = examplesOf(subset.paths['/api/system/get_zones']?.get)[0];

    expect(parseStatusEnvelope(example).status).toBe(true);
  });

  it('las respuestas del mock NMS cumplen el contrato', () => {
    const olts = smartoltMockResponse('/api/system/get_olts');
    expect(olts.status).toBe(200);
    const oltsParsed = parseOltsResponse(olts.body);
    expect(oltsParsed.status).toBe(true);
    expect(oltsParsed.olts[0]?.['id']).toBe('OLT-MOCK-1');

    const zones = smartoltMockResponse('/api/system/get_zones');
    expect(parseStatusEnvelope(zones.body).status).toBe(true);

    const page = smartoltMockResponse('/api/onu/get_all_onus_details?page=1&page_size=100');
    const pageParsed = parseOnusPageResponse(page.body);
    expect(pageParsed.status).toBe(true);
    expect(pageParsed.page).toBe(1);
    expect(pageParsed.pageSize).toBe(100);
    expect(pageParsed.totalItems).toBe(pageParsed.onus.length);
    expect(pageParsed.onus[0]?.['unique_external_id']).toBe('ONU-MOCK-1');

    const uptime = smartoltMockResponse(
      '/api/olt/get_olt_uptime_and_env_temperature/OLT-MOCK-1',
    );
    const uptimeParsed = parseOltUptimeResponse(uptime.body);
    expect(uptimeParsed.status).toBe(true);
    expect(uptimeParsed.temperatureCelsius).toBeGreaterThan(0);
    expect(uptimeParsed.uptimeSeconds).toBeGreaterThan(0);
  });

  it('el export completo del mock sigue teniendo la forma sin paginar', () => {
    const full = smartoltMockResponse('/api/onu/get_all_onus_details');
    const body = full.body as Record<string, unknown>;

    expect(body['page']).toBeUndefined();
    expect(parseOnusPageResponse(body).onus).toHaveLength(1);
  });
});
