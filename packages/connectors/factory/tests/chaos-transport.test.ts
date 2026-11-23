import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const smartoltUrl = 'https://smartolt.tenant-chaos-a.example';
const mikrowispUrl = 'https://mikrowisp.tenant-chaos-b.example';
const timeoutMs = 100;

function transportReset(): TypeError {
  return new TypeError('fetch failed', {
    cause: Object.assign(new Error('Connection reset during read'), { code: 'ECONNRESET' }),
  });
}

const providers = [
  {
    name: 'SmartOLT',
    healthy: { status: true, response: [{ id: 'chaos-olt', name: 'Lab OLT', ip: '192.0.2.10' }] },
    inventoryId: 'chaos-olt',
    parseError: 'SmartoltResponseShapeError',
    async connect(fetchImpl: typeof fetch) {
      const { SmartOltClient } = await import('@ftth-copilot/connectors-smartolt');
      return new SmartOltClient({
        apiBaseUrl: smartoltUrl, apiKey: 'fixture-only', useMock: false, fetchImpl,
        sleep: async () => {},
      });
    },
  },
  {
    name: 'Mikrowisp',
    healthy: {
      estado: 'exito',
      routers: [{ id: 'chaos-router', nombre: 'Lab router', ip: '198.51.100.10', estado: 'activo' }],
    },
    inventoryId: 'chaos-router',
    parseError: 'SyntaxError',
    async connect(fetchImpl: typeof fetch) {
      const { MikrowispClient } = await import('@ftth-copilot/connectors-mikrowisp');
      return new MikrowispClient({
        apiBaseUrl: mikrowispUrl, token: 'fixture-only', useMock: false, fetchImpl,
      });
    },
  },
];

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('NMS_REQUEST_TIMEOUT_MS', String(timeoutMs));
  vi.stubEnv('NMS_ALLOWED_HOSTS', 'smartolt.tenant-chaos-a.example,mikrowisp.tenant-chaos-b.example');
  vi.stubEnv('NMS_ALLOWED_PORTS', '443');
});

afterEach(() => vi.unstubAllEnvs());

describe.each(providers)('$name transport chaos', ({ connect, healthy, inventoryId, parseError }) => {
  it('reports latency for a slow reply that arrives within the budget', async () => {
    const transport = vi.fn<typeof fetch>(async (_url, init) => {
      await delay(15, undefined, { signal: init?.signal ?? undefined });
      return Response.json(healthy);
    });

    const client = await connect(transport);
    const result = await client.ping();
    expect(result).toEqual({ ok: true, latencyMs: expect.any(Number) });
    expect(result.latencyMs).toBeGreaterThanOrEqual(10);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('aborts a stalled read at the configured timeout and recovers on the next call', async () => {
    const transport = vi.fn<typeof fetch>()
      .mockImplementationOnce(async (_url, init) => {
        const signal = init?.signal;
        if (!signal) throw new Error('Missing timeout signal');
        // The extra timer keeps the probe referenced until the native deadline fires.
        await delay(timeoutMs * 5, undefined, { signal }).catch((error: unknown) => {
          throw signal.aborted ? signal.reason : error;
        });
        throw new Error('Transport exceeded the configured timeout');
      })
      .mockImplementationOnce(async () => Response.json(healthy));

    const client = await connect(transport);
    await expect(client.ping()).resolves.toEqual({
      ok: false, error: expect.stringMatching(/timeout/i),
    });
    const signal = transport.mock.calls[0]?.[1]?.signal;
    expect(signal?.reason).toMatchObject({ name: 'TimeoutError' });
    expect(transport).toHaveBeenCalledTimes(1);
    await expect(client.ping()).resolves.toMatchObject({ ok: true });
  });

  it('surfaces a network reset and rejects a truncated JSON inventory before recovering', async () => {
    const transport = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(transportReset())
      .mockImplementationOnce(async () => new Response('{"partial":', {
        headers: { 'content-type': 'application/json' },
      }))
      .mockImplementationOnce(async () => Response.json(healthy));

    const client = await connect(transport);
    await expect(client.listOlts()).rejects.toMatchObject({
      cause: expect.objectContaining({ code: 'ECONNRESET' }),
    });
    expect(transport).toHaveBeenCalledTimes(1);
    await expect(client.listOlts()).rejects.toMatchObject({ name: parseError });
    expect(transport).toHaveBeenCalledTimes(2);
    await expect(client.listOlts()).resolves.toMatchObject([{ id: inventoryId }]);
    expect(transport).toHaveBeenCalledTimes(3);
  });
});

it('honors SmartOLT Retry-After and retries once after a 429', async () => {
  const { SmartOltClient } = await import('@ftth-copilot/connectors-smartolt');
  const transport = vi.fn<typeof fetch>()
    .mockImplementationOnce(async () => Response.json({}, {
      status: 429, headers: { 'retry-after': '2' },
    }))
    .mockImplementationOnce(async () => Response.json({ status: true, response: [] }));
  const sleep = vi.fn(async (_ms: number) => {
    expect(transport).toHaveBeenCalledTimes(1);
  });
  const client = new SmartOltClient({
    apiBaseUrl: smartoltUrl, apiKey: 'fixture-only', useMock: false,
    fetchImpl: transport, sleep, env: {},
  });

  await expect(client.ping()).resolves.toMatchObject({ ok: true });
  expect(sleep.mock.calls).toEqual([[2000]]);
  expect(transport).toHaveBeenCalledTimes(2);
});
