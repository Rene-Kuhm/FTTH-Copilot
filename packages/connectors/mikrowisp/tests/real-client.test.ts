import { describe, it, expect, vi } from 'vitest';
import { MikrowispClient } from '../src/client';

const SAMPLE_ROUTERS_RESPONSE = {
  estado: 'exito',
  routers: [
    {
      id: 'RT-TEST-01',
      nombre: 'MikroTik-Test',
      ip: '10.0.0.1',
      coordenadas: '-34.60,-58.38',
      version: '7.12.1',
      estado: 'activo',
      modelo: 'RB4011',
      serial: 'SNMK00001',
    },
    {
      id: 'RT-TEST-02',
      nombre: 'MikroTik-Test2',
      ip: '10.0.0.2',
      coordenadas: '-34.61,-58.39',
      version: '7.11.2',
      estado: 'inactivo',
      modelo: 'hAP ac²',
      serial: 'SNMK00002',
    },
  ],
};

const SAMPLE_MONITOREO_RESPONSE = {
  estado: 'exito',
  equipos: [
    { id: 'EQ-001', nombre: 'OLT-Huawei', equipo: 'Huawei MA5600T', ip: '10.10.1.1', estado: 1 },
    { id: 'EQ-002', nombre: 'OLT-ZTE', equipo: 'ZTE C300', ip: '10.10.2.1', estado: 0 },
  ],
};

const SAMPLE_CLIENTES_RESPONSE = {
  estado: 'exito',
  clientes: [
    { id: 'CLI-001', nombre: 'Test User', estado: 'ACTIVO', correo: 'test@test.com', telefono: '011-1234', movil: '11-5555', cedula: '30123456', direccion_principal: 'Calle 123', servicios: 'FTTH-100M' },
    { id: 'CLI-002', nombre: 'Suspended User', estado: 'SUSPENDIDO', correo: 'sus@test.com', telefono: '011-5678', movil: '11-6666', cedula: '30234567', direccion_principal: 'Calle 456', servicios: 'FTTH-50M' },
  ],
};

const SAMPLE_ODBS_RESPONSE = {
  estado: 'exito',
  odbs: [
    { id: 'ODB-01', nombre_odb: 'NAP-CENTRO-01' },
    { id: 'ODB-02', nombre_odb: 'NAP-NORTE-02' },
  ],
};

function makeMockFetch(
  responses: Array<{ match: RegExp; status?: number; body: unknown }>,
): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const r = responses.find((x) => x.match.test(url));
    if (!r) throw new Error(`No mock response for ${url}`);
    return new Response(JSON.stringify(r.body), {
      status: r.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

describe('MikrowispClient (real mode)', () => {
  const apiBaseUrl = 'https://demo.mikrowisp.com/api/v1';
  const token = 'test-token-1234';

  it('ping returns ok when the API responds 200', async () => {
    const fetchImpl = makeMockFetch([
      { match: /GetRouters/, body: SAMPLE_ROUTERS_RESPONSE },
    ]);
    const client = new MikrowispClient({ useMock: false, token, apiBaseUrl, fetchImpl });
    const r = await client.ping();
    expect(r.ok).toBe(true);
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('ping returns error when the API fails', async () => {
    const fetchImpl = makeMockFetch([
      { match: /GetRouters/, status: 500, body: { estado: 'error' } },
    ]);
    const client = new MikrowispClient({ useMock: false, token, apiBaseUrl, fetchImpl });
    const r = await client.ping();
    expect(r.ok).toBe(false);
    expect(r.error).toBeDefined();
  });

  it('sends token in POST body (not headers)', async () => {
    let capturedBody: string | undefined;
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = init?.body as string | undefined;
      return new Response(JSON.stringify(SAMPLE_ROUTERS_RESPONSE), { status: 200 });
    }) as typeof fetch;
    const client = new MikrowispClient({ useMock: false, token, apiBaseUrl, fetchImpl });
    await client.listOlts();
    expect(capturedBody).toBeDefined();
    const parsed = JSON.parse(capturedBody!);
    expect(parsed.token).toBe(token);
  });

  it('sends POST method on all requests', async () => {
    let capturedMethod: string | undefined;
    let capturedRedirect: RequestRedirect | undefined;
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedMethod = init?.method;
      capturedRedirect = init?.redirect;
      return new Response(JSON.stringify(SAMPLE_ROUTERS_RESPONSE), { status: 200 });
    }) as typeof fetch;
    const client = new MikrowispClient({ useMock: false, token, apiBaseUrl, fetchImpl });
    await client.listOlts();
    expect(capturedMethod).toBe('POST');
    expect(capturedRedirect).toBe('error');
  });

  it('listOlts maps real routers to OltSummary', async () => {
    const fetchImpl = makeMockFetch([
      { match: /GetRouters/, body: SAMPLE_ROUTERS_RESPONSE },
    ]);
    const client = new MikrowispClient({ useMock: false, token, apiBaseUrl, fetchImpl });
    const olts = await client.listOlts();
    expect(olts).toHaveLength(2);
    expect(olts[0]?.id).toBe('RT-TEST-01');
    expect(olts[0]?.name).toBe('MikroTik-Test');
    expect(olts[0]?.ip).toBe('10.0.0.1');
    expect(olts[0]?.status).toBe('online');
    expect(olts[1]?.status).toBe('offline');
  });

  it('listOnus maps equipos to OnuSummary via estado field', async () => {
    const fetchImpl = makeMockFetch([
      { match: /GetMonitoreo/, body: SAMPLE_MONITOREO_RESPONSE },
    ]);
    const client = new MikrowispClient({ useMock: false, token, apiBaseUrl, fetchImpl });
    const onus = await client.listOnus();
    expect(onus).toHaveLength(2);
    expect(onus[0]?.id).toBe('EQ-001');
    expect(onus[0]?.status).toBe('online');
    expect(onus[1]?.status).toBe('offline');
  });

  it('searchByCustomerName searches the live monitoring response', async () => {
    const fetchImpl = makeMockFetch([
      { match: /GetMonitoreo/, body: SAMPLE_MONITOREO_RESPONSE },
    ]);
    const client = new MikrowispClient({ useMock: false, token, apiBaseUrl, fetchImpl });
    const onus = await client.searchByCustomerName('huawei');
    expect(onus).toHaveLength(1);
    expect(onus[0]?.customerName).toBe('OLT-Huawei');
  });

  it('listClients maps real client data', async () => {
    const fetchImpl = makeMockFetch([
      { match: /GetAllClients/, body: SAMPLE_CLIENTES_RESPONSE },
    ]);
    const client = new MikrowispClient({ useMock: false, token, apiBaseUrl, fetchImpl });
    const clientes = await client.listClients();
    expect(clientes).toHaveLength(2);
    expect(clientes[0]?.nombre).toBe('Test User');
    expect(clientes[0]?.estado).toBe('ACTIVO');
    expect(clientes[1]?.estado).toBe('SUSPENDIDO');
  });

  it('listClients filters by status', async () => {
    const fetchImpl = makeMockFetch([
      { match: /GetAllClients/, body: SAMPLE_CLIENTES_RESPONSE },
    ]);
    const client = new MikrowispClient({ useMock: false, token, apiBaseUrl, fetchImpl });
    const activos = await client.listClients({ status: 'ACTIVO' });
    expect(activos).toHaveLength(1);
    expect(activos[0]?.estado).toBe('ACTIVO');
  });

  it('getOdbList maps real ODB data', async () => {
    const fetchImpl = makeMockFetch([
      { match: /SmartOltGetODB/, body: SAMPLE_ODBS_RESPONSE },
    ]);
    const client = new MikrowispClient({ useMock: false, token, apiBaseUrl, fetchImpl });
    const odbs = await client.getOdbList();
    expect(odbs).toHaveLength(2);
    expect(odbs[0]?.nombre_odb).toBe('NAP-CENTRO-01');
  });

  it('throws on estado: "error" response', async () => {
    const fetchImpl = makeMockFetch([
      { match: /GetRouters/, body: { estado: 'error', mensaje: 'Token invalido' } },
    ]);
    const client = new MikrowispClient({ useMock: false, token, apiBaseUrl, fetchImpl });
    await expect(client.listOlts()).rejects.toThrow('Token invalido');
  });

  it('throws when apiBaseUrl or token missing in real mode', async () => {
    const client = new MikrowispClient({ useMock: false });
    await expect(client.listOlts()).rejects.toThrow(/apiBaseUrl.*token/);
  });

  it('realFetch appends path to apiBaseUrl without double slashes', async () => {
    let capturedUrl = '';
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      capturedUrl = typeof url === 'string' ? url : url.toString();
      return new Response(JSON.stringify(SAMPLE_ROUTERS_RESPONSE), { status: 200 });
    }) as typeof fetch;
    const client = new MikrowispClient({
      useMock: false,
      token,
      apiBaseUrl: 'https://demo.mikrowisp.com/api/v1/',
      fetchImpl,
    });
    await client.listOlts();
    expect(capturedUrl).toBe('https://demo.mikrowisp.com/api/v1/GetRouters');
  });

  it('getNetworkOverview aggregates real data', async () => {
    const fetchImpl = makeMockFetch([
      { match: /GetRouters/, body: SAMPLE_ROUTERS_RESPONSE },
      { match: /GetMonitoreo/, body: SAMPLE_MONITOREO_RESPONSE },
    ]);
    const client = new MikrowispClient({ useMock: false, token, apiBaseUrl, fetchImpl });
    const overview = await client.getNetworkOverview();
    expect(overview.totalOlts).toBe(2);
    expect(overview.totalOnus).toBe(2);
    expect(overview.onusOnline).toBe(1);
    expect(overview.onusOffline).toBe(1);
    expect(overview.oltsOnline).toBe(1);
  });

  it('throws on HTTP 500', async () => {
    const fetchImpl = makeMockFetch([
      { match: /GetRouters/, status: 500, body: { error: 'internal' } },
    ]);
    const client = new MikrowispClient({ useMock: false, token, apiBaseUrl, fetchImpl });
    const r = await client.ping();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/500/);
  });
});
