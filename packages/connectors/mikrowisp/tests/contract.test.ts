/**
 * Tests de contrato de Mikrowisp (S4).
 *
 * Corren offline contra `contract/mikrowisp-openapi.subset.json`, generado por
 * `scripts/sync-contract.ts` desde el espejo machine-readable de la
 * documentación del proveedor. Validan lo que el cliente pide (ruta, método,
 * forma del cuerpo) y lo que espera recibir (los ejemplos oficiales parsean
 * con los esquemas del cliente).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { MikrowispClient } from '../src/client';
import { mikrowispMockResponse } from '../src/mock-nms';
import {
  parseMikrowispClientes,
  parseMikrowispMonitoreo,
  parseMikrowispOdbs,
  parseMikrowispRouters,
} from '../src/schemas';

const SUBSET_URL = new URL('../contract/mikrowisp-openapi.subset.json', import.meta.url);

interface SubsetSchema {
  properties?: Record<string, unknown>;
  required?: string[];
}

interface SubsetOperation {
  parameters?: Array<{ name: string; in: string }>;
  requestBody?: { content?: Record<string, { schema?: SubsetSchema }> };
  responses?: Record<string, unknown>;
}

interface Subset {
  provenance: {
    sourceUrl: string;
    canonicalDocsUrl: string;
    sourceKind: string;
    retrievedAt: string;
    subset: boolean;
    note: string;
  };
  paths: Record<string, { post?: SubsetOperation }>;
}

function loadSubset(): Subset {
  return JSON.parse(readFileSync(SUBSET_URL, 'utf8')) as Subset;
}

/** Los endpoints que el cliente llama. Si el cliente suma uno, esto se actualiza. */
const CLIENT_ENDPOINTS = [
  '/GetRouters',
  '/GetMonitoreo',
  '/GetAllClients',
  '/SmartOltGetODB',
] as const;

/** El primer ejemplo 200 de una operación. */
function exampleOf(operation: SubsetOperation | undefined): unknown {
  const ok = (operation?.responses?.['200'] ?? {}) as {
    content?: Record<string, { example?: unknown; examples?: Record<string, { value?: unknown }> }>;
  };
  const json = ok.content?.['application/json'];
  if (!json) return undefined;
  if (json.example !== undefined) return json.example;
  const named = json.examples ? Object.values(json.examples) : [];
  return named[0]?.value;
}

/**
 * Un Mikrowisp de mentira armado desde la especificación.
 *
 * Falla si el cliente llama a una ruta que el contrato no publica, si el
 * método no es POST, si el cuerpo lleva un parámetro no declarado o si le
 * falta uno obligatorio.
 */
function specFetch(subset: Subset): { fetchImpl: typeof fetch; requests: string[] } {
  const requests: string[] = [];

  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input.toString();
    requests.push(raw);
    const url = new URL(raw);
    // La base configurada es `https://demo.mikrowisp.com/api/v1`; el contrato
    // lista los endpoints relativos a esa base.
    const endpoint = url.pathname.replace(/^\/api\/v1/, '');

    const operation = subset.paths[endpoint]?.post;
    if (!operation) {
      throw new Error(`El cliente llamó a ${endpoint}, que no está en el contrato`);
    }
    if (init?.method !== 'POST') {
      throw new Error(`El contrato declara POST para ${endpoint}, el cliente usó ${init?.method}`);
    }

    const schema = operation.requestBody?.content?.['application/json']?.schema ?? {};
    const declared = new Set(Object.keys(schema.properties ?? {}));
    const body = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>;

    for (const key of Object.keys(body)) {
      if (!declared.has(key)) {
        throw new Error(`El cliente mandó "${key}" a ${endpoint}, que no declara ese parámetro`);
      }
    }
    for (const required of schema.required ?? []) {
      if (!(required in body)) {
        throw new Error(`Al cuerpo de ${endpoint} le falta el parámetro obligatorio "${required}"`);
      }
    }

    const example = exampleOf(operation);
    if (example === undefined) {
      throw new Error(`El contrato no publica ejemplo 200 para ${endpoint}`);
    }

    return new Response(JSON.stringify(example), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;

  return { fetchImpl, requests };
}

function newClient(fetchImpl: typeof fetch): MikrowispClient {
  return new MikrowispClient({
    useMock: false,
    token: 'contract-test-token',
    apiBaseUrl: 'https://demo.mikrowisp.com/api/v1',
    fetchImpl,
  });
}

describe('el contrato de Mikrowisp', () => {
  const subset = loadSubset();

  it('registra de dónde salió y que es un subconjunto', () => {
    expect(subset.provenance.subset).toBe(true);
    expect(subset.provenance.sourceUrl).toBe(
      'https://skmtc.dev/mikrosystem/apis/mikrowisp/revisions/636806eac943?raw',
    );
    expect(subset.provenance.canonicalDocsUrl).toBe('https://docs.mikrosystem.net');
    expect(subset.provenance.retrievedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(subset.provenance.note).toMatch(/skmtc\.dev/);
  });

  it('incluye exactamente los endpoints que el cliente llama', () => {
    expect(Object.keys(subset.paths).sort()).toEqual([...CLIENT_ENDPOINTS].sort());
  });
});

describe('lo que el cliente pide', () => {
  const subset = loadSubset();

  it('todas las llamadas pasan el contrato de ruta, método y cuerpo', async () => {
    const { fetchImpl, requests } = specFetch(subset);
    const client = newClient(fetchImpl);

    const ping = await client.ping();
    const olts = await client.listOlts();
    const detail = await client.getOltDetail(olts[0]?.id ?? '');
    const onus = await client.listOnus();
    const overview = await client.getNetworkOverview();
    await client.getOnusWithLowSignal(-27);
    await client.searchByCustomerName('javier');
    await client.getOnuDetail(onus[0]?.id ?? '');
    await client.listClients();
    await client.getOdbList();
    await client.getOdnComponents();

    expect(ping.ok).toBe(true);
    expect(detail.id).toBe(olts[0]?.id);
    expect(overview.totalOlts).toBeGreaterThan(0);
    expect(onus.length).toBeGreaterThan(0);

    const touched = [
      ...new Set(requests.map((request) => new URL(request).pathname.replace(/^\/api\/v1/, ''))),
    ].sort();
    expect(touched).toEqual([...CLIENT_ENDPOINTS].sort());
  });
});

describe('lo que el cliente espera recibir', () => {
  const subset = loadSubset();

  it('parsea el ejemplo de GetRouters', () => {
    const parsed = parseMikrowispRouters(exampleOf(subset.paths['/GetRouters']?.post));

    expect(parsed.estado).toBe('exito');
    expect(parsed.routers).toHaveLength(1);
    expect(parsed.routers[0]?.['nombre']).toBe('RB Principal');
  });

  it('parsea el ejemplo de GetMonitoreo', () => {
    const parsed = parseMikrowispMonitoreo(exampleOf(subset.paths['/GetMonitoreo']?.post));

    expect(parsed.estado).toBe('exito');
    expect(parsed.equipos[0]?.['id']).toBe(1);
  });

  it('parsea el ejemplo de GetAllClients', () => {
    const parsed = parseMikrowispClientes(exampleOf(subset.paths['/GetAllClients']?.post));

    expect(parsed.estado).toBe('exito');
    expect(parsed.clientes.length).toBeGreaterThan(0);
    expect(parsed.clientes[0]?.['nombre']).toBeDefined();
  });

  it('parsea el ejemplo de SmartOltGetODB', () => {
    const parsed = parseMikrowispOdbs(exampleOf(subset.paths['/SmartOltGetODB']?.post));

    expect(parsed.code).toBe('200');
    expect(parsed.odbs[0]?.['nombre_odb']).toBe('Damajagua');
  });

  it('las respuestas del mock NMS cumplen el contrato', () => {
    const routers = mikrowispMockResponse('/GetRouters');
    expect(routers.status).toBe(200);
    expect(parseMikrowispRouters(routers.body).routers[0]?.['id']).toBe('RT-MOCK-1');

    const monitoreo = mikrowispMockResponse('/GetMonitoreo');
    expect(parseMikrowispMonitoreo(monitoreo.body).equipos[0]?.['id']).toBe('EQ-MOCK-1');

    expect(mikrowispMockResponse('/GetMonitoreo').body).toHaveProperty('estado', 'exito');
  });
});
