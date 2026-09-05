import { describe, it, expect, vi } from 'vitest';
import { SmartOltClient } from '../src/client';

const SAMPLE_OLTS_RESPONSE = {
  status: true,
  response: [
    {
      id: '1',
      name: 'Huawei',
      olt_hardware_version: 'Huawei-MA5680T',
      ip: '1.2.3.4',
      telnet_port: '2333',
      snmp_port: '2161',
    },
  ],
};

const SAMPLE_ONUS_RESPONSE = {
  status: true,
  onus: [
    {
      unique_external_id: 'ONU-0001',
      sn: 'HWTC12341234',
      olt_id: '1',
      olt_name: 'Huawei',
      board: '1',
      port: '1',
      onu: '0',
      onu_type_name: 'Huawei-HG8145V5',
      name: 'Test customer',
      status: 'Online',
      signal: '-19.5',
    },
    {
      unique_external_id: 'ONU-0002',
      sn: 'HWTC5678',
      olt_id: '1',
      olt_name: 'Huawei',
      board: '1',
      port: '2',
      onu: '1',
      onu_type_name: 'Huawei-HG8245H',
      name: 'Customer 2',
      status: 'Offline',
      signal: '-30.0',
    },
  ],
};

// OpenSpec p2-2-optical-metrics / REQ "OnuSummary field" + REQ "SmartOLT
// defensive mapping" — the connector MUST resolve `losSecondsTotal` from any
// of six candidate field names the SmartOLT NMS has shipped across versions:
// `los_seconds_total`, `los_seconds`, `losCount`, `los_count`,
// `loss_of_signal_seconds`, `signal_loss_seconds`. Unresolved MUST yield
// `undefined` (Mikrowisp graceful no-op).
const SAMPLE_ONUS_WITH_LOS_CANDIDATES: Record<string, { payload: Record<string, unknown>; expected: number }> = {
  los_seconds_total: { payload: { los_seconds_total: 120 }, expected: 120 },
  los_seconds: { payload: { los_seconds: 45 }, expected: 45 },
  losCount: { payload: { losCount: 7 }, expected: 7 },
  los_count: { payload: { los_count: 90 }, expected: 90 },
  loss_of_signal_seconds: { payload: { loss_of_signal_seconds: 240 }, expected: 240 },
  signal_loss_seconds: { payload: { signal_loss_seconds: 12 }, expected: 12 },
};

function makeMockFetch(responses: Array<{ match: RegExp; status?: number; body: unknown }>): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    const r = responses.find((x) => x.match.test(url));
    if (!r) {
      throw new Error(`No mock response for ${url}`);
    }
    return new Response(JSON.stringify(r.body), {
      status: r.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

describe('SmartOltClient (real mode)', () => {
  const apiBaseUrl = 'https://demo.smartolt.com';
  const apiKey = 'sk-test-1234';

  it('ping returns ok when the API responds 200', async () => {
    const fetchImpl = makeMockFetch([
      { match: /\/api\/system\/get_olts/, body: { status: true, response: [] } },
    ]);
    const client = new SmartOltClient({ useMock: false, apiKey, apiBaseUrl, fetchImpl });
    const r = await client.ping();
    expect(r.ok).toBe(true);
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('ping returns error when the API fails', async () => {
    const fetchImpl = makeMockFetch([
      { match: /get_olts/, status: 401, body: { status: false, response: {} } },
    ]);
    const client = new SmartOltClient({ useMock: false, apiKey, apiBaseUrl, fetchImpl });
    const r = await client.ping();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/401/);
  });

  it('listOlts maps real SmartOLT response to OltSummary', async () => {
    const fetchImpl = makeMockFetch([{ match: /get_olts/, body: SAMPLE_OLTS_RESPONSE }]);
    const client = new SmartOltClient({ useMock: false, apiKey, apiBaseUrl, fetchImpl });
    const olts = await client.listOlts();
    expect(olts).toHaveLength(1);
    expect(olts[0]?.id).toBe('1');
    expect(olts[0]?.name).toBe('Huawei');
    expect(olts[0]?.ip).toBe('1.2.3.4');
    expect(olts[0]?.status).toBe('online');
  });

  it('listOnus maps real SmartOLT response to OnuSummary', async () => {
    const fetchImpl = makeMockFetch([{ match: /get_all_onus_details/, body: SAMPLE_ONUS_RESPONSE }]);
    const client = new SmartOltClient({ useMock: false, apiKey, apiBaseUrl, fetchImpl });
    const onus = await client.listOnus();
    expect(onus).toHaveLength(2);
    expect(onus[0]?.id).toBe('ONU-0001');
    expect(onus[0]?.serial).toBe('HWTC12341234');
    expect(onus[0]?.oltId).toBe('1');
    expect(onus[0]?.status).toBe('online');
    expect(onus[0]?.rxPowerDbm).toBe(-19.5);
    expect(onus[1]?.status).toBe('offline');
    expect(onus[1]?.rxPowerDbm).toBe(-30.0);
  });

  it('listOnus filters by status', async () => {
    const fetchImpl = makeMockFetch([{ match: /get_all_onus_details/, body: SAMPLE_ONUS_RESPONSE }]);
    const client = new SmartOltClient({ useMock: false, apiKey, apiBaseUrl, fetchImpl });
    const offline = await client.listOnus({ status: 'offline' });
    expect(offline).toHaveLength(1);
    expect(offline[0]?.id).toBe('ONU-0002');
  });

  it('getOnuDetail returns null for unknown identifier', async () => {
    const fetchImpl = makeMockFetch([{ match: /get_all_onus_details/, body: SAMPLE_ONUS_RESPONSE }]);
    const client = new SmartOltClient({ useMock: false, apiKey, apiBaseUrl, fetchImpl });
    const result = await client.getOnuDetail('NONEXISTENT');
    expect(result).toBeNull();
  });

  it('getOnuDetail finds by id', async () => {
    const fetchImpl = makeMockFetch([{ match: /get_all_onus_details/, body: SAMPLE_ONUS_RESPONSE }]);
    const client = new SmartOltClient({ useMock: false, apiKey, apiBaseUrl, fetchImpl });
    const result = await client.getOnuDetail('ONU-0001');
    expect(result?.id).toBe('ONU-0001');
    expect(result?.vendor).toBe('Huawei');
    expect(result?.model).toBe('HG8145V5');
    expect(result?.oltPort).toBe('1/1/0');
  });

  it('getOnusWithLowSignal filters by threshold', async () => {
    const fetchImpl = makeMockFetch([{ match: /get_all_onus_details/, body: SAMPLE_ONUS_RESPONSE }]);
    const client = new SmartOltClient({ useMock: false, apiKey, apiBaseUrl, fetchImpl });
    const low = await client.getOnusWithLowSignal(-27);
    expect(low).toHaveLength(1);
    expect(low[0]?.id).toBe('ONU-0002');
  });

  it('sends X-Token header on requests', async () => {
    let capturedHeaders: Record<string, string> = {};
    let capturedRedirect: RequestRedirect | undefined;
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedHeaders = (init?.headers as Record<string, string>) ?? {};
      capturedRedirect = init?.redirect;
      return new Response(JSON.stringify({ status: true, response: [] }), { status: 200 });
    }) as typeof fetch;
    const client = new SmartOltClient({ useMock: false, apiKey, apiBaseUrl, fetchImpl });
    await client.listOlts();
    expect(capturedHeaders['X-Token']).toBe(apiKey);
    expect(capturedRedirect).toBe('error');
  });

  it('realFetch appends path to apiBaseUrl without trailing slash', async () => {
    let capturedUrl = '';
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      capturedUrl = typeof url === 'string' ? url : url.toString();
      return new Response(JSON.stringify({ status: true, response: [] }), { status: 200 });
    }) as typeof fetch;
    const client = new SmartOltClient({
      useMock: false,
      apiKey,
      apiBaseUrl: 'https://demo.smartolt.com/', // trailing slash
      fetchImpl,
    });
    await client.listOlts();
    expect(capturedUrl).toBe('https://demo.smartolt.com/api/system/get_olts');
  });

  it('throws when apiBaseUrl or apiKey missing in real mode', async () => {
    const client = new SmartOltClient({ useMock: false });
    await expect(client.listOlts()).rejects.toThrow(/apiBaseUrl.*apiKey/);
  });

  // P2.2 — OnuSummary.losSecondsTotal resolved from each SmartOLT LOS
  // candidate key (per design.md AD-3 / `los-collection` spec REQ "SmartOLT
  // defensive mapping"). Each case wires ONE candidate field on the mock
  // payload and asserts the losSecondsTotal numeric comes through unchanged.
  // RED before the mapOnuSummary candidate-list extension lands.
  for (const [candidate, { payload, expected }] of Object.entries(
    SAMPLE_ONUS_WITH_LOS_CANDIDATES,
  )) {
    it(`maps losSecondsTotal from the "${candidate}" SmartOLT candidate`, async () => {
      const body = {
        status: true,
        onus: [
          {
            unique_external_id: 'ONU-LOS-1',
            sn: 'HWTC9999',
            olt_id: '1',
            olt_name: 'Huawei',
            board: '1',
            port: '1',
            onu: '0',
            onu_type_name: 'Huawei-HG8145V5',
            name: 'LOS test',
            status: 'Online',
            signal: '-19.5',
            ...payload,
          },
        ],
      };
      const fetchImpl = makeMockFetch([{ match: /get_all_onus_details/, body }]);
      const client = new SmartOltClient({ useMock: false, apiKey, apiBaseUrl, fetchImpl });
      const onus = await client.listOnus();
      expect(onus).toHaveLength(1);
      expect(onus[0]?.losSecondsTotal).toBe(expected);
    });
  }

  it('leaves losSecondsTotal undefined when no LOS candidate is present (Mikrowisp-shaped payload)', async () => {
    const body = {
      status: true,
      onus: [
        {
          unique_external_id: 'ONU-LOS-2',
          sn: 'HWTC8888',
          olt_id: '1',
          olt_name: 'Huawei',
          board: '1',
          port: '1',
          onu: '0',
          onu_type_name: 'Huawei-HG8145V5',
          name: 'No LOS',
          status: 'Online',
          signal: '-19.5',
          // Note: no LOS candidate field at all.
        },
      ],
    };
    const fetchImpl = makeMockFetch([{ match: /get_all_onus_details/, body }]);
    const client = new SmartOltClient({ useMock: false, apiKey, apiBaseUrl, fetchImpl });
    const onus = await client.listOnus();
    expect(onus).toHaveLength(1);
    expect(onus[0]?.losSecondsTotal).toBeUndefined();
  });

  it('getNetworkOverview aggregates real data', async () => {
    const fetchImpl = makeMockFetch([
      { match: /get_olts/, body: SAMPLE_OLTS_RESPONSE },
      { match: /get_all_onus_details/, body: SAMPLE_ONUS_RESPONSE },
    ]);
    const client = new SmartOltClient({ useMock: false, apiKey, apiBaseUrl, fetchImpl });
    const overview = await client.getNetworkOverview();
    expect(overview.totalOlts).toBe(1);
    expect(overview.totalOnus).toBe(2);
    expect(overview.onusOnline).toBe(1);
    expect(overview.onusOffline).toBe(1);
    expect(overview.oltsOnline).toBe(1);
  });
});
