import { describe, it, expect, vi } from 'vitest';
import * as mikrotikPkg from '../src/index';
import { MikrotikClient } from '../src/client';
import {
  FIXTURE_SYSTEM_RESOURCE,
  FIXTURE_INTERFACES,
  FIXTURE_SFP_METRICS,
  FIXTURE_PPPOE_SESSIONS,
  FIXTURE_BGP_SESSIONS,
} from '../src/fixtures';

describe('MikrotikClient (mock mode)', () => {
  const client = new MikrotikClient({ useMock: true });

  it('reports providerName as mikrotik', () => {
    expect(client.providerName).toBe('mikrotik');
  });

  it('pings successfully in mock mode', async () => {
    const res = await client.ping();
    expect(res.ok).toBe(true);
    expect(res.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('returns fixture system resource', async () => {
    const res = await client.getSystemResource();
    expect(res).toEqual(FIXTURE_SYSTEM_RESOURCE);
    expect(res.boardName).toBe('CCR2004-1G-12S+2XS');
    expect(res.cpuLoad).toBe(18);
  });

  it('lists and filters interfaces', async () => {
    const all = await client.listInterfaces();
    expect(all.length).toBe(FIXTURE_INTERFACES.length);

    const running = await client.listInterfaces({ runningOnly: true });
    expect(running.every((i) => i.running)).toBe(true);
    expect(running.length).toBe(5);

    const vlans = await client.listInterfaces({ type: 'vlan' });
    expect(vlans.length).toBe(2);
    expect(vlans.every((i) => i.type === 'vlan')).toBe(true);
  });

  it('retrieves SFP optical metrics for known interface', async () => {
    const sfp1 = await client.getSfpOpticalMetrics('sfp-sfpplus1');
    expect(sfp1).toEqual(FIXTURE_SFP_METRICS['sfp-sfpplus1']);
    expect(sfp1?.sfpRxPowerDbm).toBe(-3.8);

    const unknown = await client.getSfpOpticalMetrics('ether1');
    expect(unknown).toBeNull();
  });

  it('lists and filters PPPoE subscriber sessions', async () => {
    const all = await client.listPppoeSessions();
    expect(all.length).toBe(FIXTURE_PPPOE_SESSIONS.length);

    const filtered = await client.listPppoeSessions({ username: 'empresa' });
    expect(filtered.length).toBe(1);
    expect(filtered[0]?.name).toBe('empresa-corp@ftth.isp');
  });

  it('lists BGP routing sessions', async () => {
    const bgp = await client.listBgpSessions();
    expect(bgp).toEqual(FIXTURE_BGP_SESSIONS);
    expect(bgp[0]?.remoteAs).toBe(174);
    expect(bgp[0]?.state).toBe('established');
  });
});

describe('MikrotikClient (live HTTP mode)', () => {
  it('throws when host is missing in live mode', async () => {
    const client = new MikrotikClient({
      useMock: false,
      username: 'admin',
      password: 'pwd',
    });
    await expect(client.ping()).resolves.toEqual({
      ok: false,
      error: 'MikroTik API requires host configuration',
    });
  });

  it('throws when credentials are missing', async () => {
    const client = new MikrotikClient({
      useMock: false,
      host: 'router.isp.net',
    });
    await expect(client.getSystemResource()).rejects.toThrow(
      'MikroTik API requires username and password',
    );
  });

  it('pings real endpoint successfully with basic auth', async () => {
    let capturedUrl = '';
    let capturedHeaders: Record<string, string> = {};

    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedHeaders = init.headers as Record<string, string>;
      return new Response(JSON.stringify({ uptime: '1d' }), { status: 200 });
    }) as unknown as typeof fetch;

    const client = new MikrotikClient({
      useMock: false,
      host: 'router.isp.net',
      username: 'admin',
      password: 'supersecretpassword',
      fetchImpl,
    });

    const ping = await client.ping();
    expect(ping.ok).toBe(true);
    expect(capturedUrl).toBe('https://router.isp.net/rest/system/resource');
    expect(capturedHeaders['Authorization']).toBe(
      `Basic ${Buffer.from('admin:supersecretpassword').toString('base64')}`,
    );
  });

  it('returns failure on 401 unauthorized', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response('Unauthorized', { status: 401, statusText: 'Unauthorized' });
    }) as unknown as typeof fetch;

    const client = new MikrotikClient({
      useMock: false,
      host: 'router.isp.net',
      username: 'admin',
      password: 'bad',
      fetchImpl,
    });

    const ping = await client.ping();
    expect(ping.ok).toBe(false);
    expect(ping.error).toContain('HTTP 401');
  });

  it('parses system resources and health sensors', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/rest/system/resource')) {
        return new Response(
          JSON.stringify({
            uptime: '10d',
            version: '7.15.2',
            'build-time': '2024-06-12',
            'free-memory': 2000000000,
            'total-memory': 4000000000,
            cpu: 'ARM64',
            'cpu-count': 16,
            'cpu-frequency': 2000,
            'cpu-load': 25,
            'free-hdd-space': 1000000,
            'total-hdd-space': 2000000,
            'architecture-name': 'arm64',
            'board-name': 'CCR2116-12G-4S+',
            platform: 'MikroTik',
          }),
          { status: 200 },
        );
      }
      if (url.endsWith('/rest/system/health')) {
        return new Response(
          JSON.stringify([
            { name: 'cpu-temperature', value: '48.2' },
            { name: 'psu1-voltage', value: '12.1' },
          ]),
          { status: 200 },
        );
      }
      return new Response('Not found', { status: 404 });
    }) as unknown as typeof fetch;

    const client = new MikrotikClient({
      useMock: false,
      host: 'router.isp.net',
      username: 'admin',
      password: 'pwd',
      fetchImpl,
    });

    const res = await client.getSystemResource();
    expect(res.boardName).toBe('CCR2116-12G-4S+');
    expect(res.cpuCount).toBe(16);
    expect(res.cpuLoad).toBe(25);
    expect(res.temperatureCelsius).toBe(48.2);
    expect(res.voltageVolts).toBe(12.1);
  });

  it('fetches and filters real interfaces', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify([
          {
            '.id': '*1',
            name: 'sfp-sfpplus1',
            type: 'ether',
            running: 'true',
            disabled: 'false',
            mtu: 9000,
            'rx-byte': 1000,
            'tx-byte': 2000,
          },
          {
            '.id': '*2',
            name: 'ether8',
            type: 'ether',
            running: 'false',
            disabled: 'true',
            mtu: 1500,
            'rx-byte': 0,
            'tx-byte': 0,
          },
        ]),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const client = new MikrotikClient({
      useMock: false,
      host: 'router.isp.net',
      username: 'admin',
      password: 'pwd',
      fetchImpl,
    });

    const running = await client.listInterfaces({ runningOnly: true });
    expect(running.length).toBe(1);
    expect(running[0]?.name).toBe('sfp-sfpplus1');
    expect(running[0]?.running).toBe(true);
    expect(running[0]?.mtu).toBe(9000);
  });

  it('monitors SFP optical metrics via POST endpoint', async () => {
    let capturedBody = '';
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      capturedBody = init.body as string;
      return new Response(
        JSON.stringify([
          {
            name: 'sfp-sfpplus1',
            'sfp-rx-power': '-4.5',
            'sfp-tx-power': '1.0',
            'sfp-temperature': '42.0',
            'sfp-supply-voltage': '3.3',
            'sfp-bias-current': '6.8',
            'sfp-wavelength': '1310',
            'sfp-vendor-name': 'MikroTik',
          },
        ]),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const client = new MikrotikClient({
      useMock: false,
      host: 'router.isp.net',
      username: 'admin',
      password: 'pwd',
      fetchImpl,
    });

    const optical = await client.getSfpOpticalMetrics('sfp-sfpplus1');
    expect(JSON.parse(capturedBody)).toEqual({ numbers: 'sfp-sfpplus1', once: true });
    expect(optical?.sfpRxPowerDbm).toBe(-4.5);
    expect(optical?.sfpTxPowerDbm).toBe(1.0);
    expect(optical?.vendorName).toBe('MikroTik');
  });

  it('lists active PPPoE sessions in live mode', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify([
          {
            '.id': '*10',
            name: 'cliente-01@fibra',
            service: 'pppoe',
            'caller-id': '00:11:22:33:44:55',
            address: '100.64.1.20',
            uptime: '1d',
            'session-id': '0x123',
            radius: 'true',
          },
        ]),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const client = new MikrotikClient({
      useMock: false,
      host: 'router.isp.net',
      username: 'admin',
      password: 'pwd',
      fetchImpl,
    });

    const sessions = await client.listPppoeSessions();
    expect(sessions.length).toBe(1);
    expect(sessions[0]?.name).toBe('cliente-01@fibra');
    expect(sessions[0]?.callerId).toBe('00:11:22:33:44:55');
    expect(sessions[0]?.radius).toBe(true);
  });

  it('lists BGP sessions in live mode', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify([
          {
            '.id': '*B1',
            name: 'upstream-bgp',
            'remote.address': '198.51.100.1',
            'remote.as': '13335',
            state: 'established',
            uptime: '1w',
            'prefix-count': '850000',
          },
        ]),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const client = new MikrotikClient({
      useMock: false,
      host: 'router.isp.net',
      username: 'admin',
      password: 'pwd',
      fetchImpl,
    });

    const bgp = await client.listBgpSessions();
    expect(bgp.length).toBe(1);
    expect(bgp[0]?.name).toBe('upstream-bgp');
    expect(bgp[0]?.remoteAs).toBe(13335);
    expect(bgp[0]?.prefixCount).toBe(850000);
  });

  it('handles SFP optical metrics endpoint failure gracefully', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response('Internal error', { status: 500 });
    }) as unknown as typeof fetch;

    const client = new MikrotikClient({
      useMock: false,
      host: 'router.isp.net',
      username: 'admin',
      password: 'pwd',
      fetchImpl,
    });

    const metrics = await client.getSfpOpticalMetrics('sfp-sfpplus1');
    expect(metrics).toBeNull();
  });

  it('handles empty SFP optical metrics response', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify([]), { status: 200 });
    }) as unknown as typeof fetch;

    const client = new MikrotikClient({
      useMock: false,
      host: 'router.isp.net',
      username: 'admin',
      password: 'pwd',
      fetchImpl,
    });

    const metrics = await client.getSfpOpticalMetrics('sfp-sfpplus1');
    expect(metrics).toBeNull();
  });

  it('filters interfaces by type in live mode', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify([
          { '.id': '*1', name: 'vlan10', type: 'vlan', running: true, disabled: false },
          { '.id': '*2', name: 'ether1', type: 'ether', running: true, disabled: false },
        ]),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const client = new MikrotikClient({
      useMock: false,
      host: 'router.isp.net',
      username: 'admin',
      password: 'pwd',
      fetchImpl,
    });

    const vlans = await client.listInterfaces({ type: 'vlan' });
    expect(vlans.length).toBe(1);
    expect(vlans[0]?.type).toBe('vlan');
  });

  it('filters PPPoE sessions by username in live mode', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify([
          { '.id': '*1', name: 'alice@isp', service: 'pppoe', 'caller-id': '00:11:22', address: '10.0.0.1', uptime: '1h', 'session-id': '1' },
          { '.id': '*2', name: 'bob@isp', service: 'pppoe', 'caller-id': '00:11:33', address: '10.0.0.2', uptime: '2h', 'session-id': '2' },
        ]),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const client = new MikrotikClient({
      useMock: false,
      host: 'router.isp.net',
      username: 'admin',
      password: 'pwd',
      fetchImpl,
    });

    const filtered = await client.listPppoeSessions({ username: 'alice' });
    expect(filtered.length).toBe(1);
    expect(filtered[0]?.name).toBe('alice@isp');
  });

  it('handles empty response gracefully with defaults', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/rest/system/resource')) {
        return new Response('{}', { status: 200 });
      }
      if (url.endsWith('/rest/system/health')) {
        return new Response('{}', { status: 200 });
      }
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;

    const client = new MikrotikClient({
      useMock: false,
      host: 'router.isp.net',
      port: 443,
      username: 'admin',
      password: 'pwd',
      useTls: true,
      timeoutMs: 5000,
      fetchImpl,
    });

    const res = await client.getSystemResource();
    expect(res.uptime).toBe('');
    expect(res.cpuCount).toBe(1);
    expect(res.platform).toBe('MikroTik');
  });

  it('handles health check throwing error', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/rest/system/resource')) {
        return new Response('{}', { status: 200 });
      }
      throw new Error('Health check error');
    }) as unknown as typeof fetch;

    const client = new MikrotikClient({
      useMock: false,
      host: 'router.isp.net',
      username: 'admin',
      password: 'pwd',
      fetchImpl,
    });

    const res = await client.getSystemResource();
    expect(res.temperatureCelsius).toBeUndefined();
  });

  it('parses interfaces with optional fields missing', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify([{}]), { status: 200 });
    }) as unknown as typeof fetch;

    const client = new MikrotikClient({
      useMock: false,
      host: 'router.isp.net',
      username: 'admin',
      password: 'pwd',
      fetchImpl,
    });

    const ifaces = await client.listInterfaces();
    expect(ifaces[0]?.mtu).toBe(1500);
    expect(ifaces[0]?.comment).toBeUndefined();
  });

  it('parses SFP with object response instead of array', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          name: 'sfp1',
          'sfp-vendor-part-number': 'PN123',
          'sfp-vendor-serial': 'SN456',
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const client = new MikrotikClient({
      useMock: false,
      host: 'router.isp.net',
      username: 'admin',
      password: 'pwd',
      fetchImpl,
    });

    const sfp = await client.getSfpOpticalMetrics('sfp1');
    expect(sfp?.vendorPartNumber).toBe('PN123');
    expect(sfp?.vendorSerial).toBe('SN456');
  });

  it('parses BGP sessions with localAs and missing fields', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify([
          {
            'remote.as': '65001',
            'local.as': '65000',
            'local.address': '10.0.0.2',
            'hold-time': '90s',
            'keepalive-time': '30s',
          },
          {},
        ]),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const client = new MikrotikClient({
      useMock: false,
      host: 'router.isp.net',
      username: 'admin',
      password: 'pwd',
      fetchImpl,
    });

    const bgp = await client.listBgpSessions();
    expect(bgp[0]?.localAs).toBe(65000);
    expect(bgp[0]?.localAddress).toBe('10.0.0.2');
    expect(bgp[1]?.state).toBe('unknown');
  });
});

describe('MikroTik Package Exports', () => {
  it('exports MikrotikClient and fixtures from package entrypoint', () => {
    expect(mikrotikPkg.MikrotikClient).toBeDefined();
    expect(mikrotikPkg.FIXTURE_SYSTEM_RESOURCE).toBeDefined();
    expect(mikrotikPkg.FIXTURE_INTERFACES).toBeDefined();
    expect(mikrotikPkg.FIXTURE_SFP_METRICS).toBeDefined();
    expect(mikrotikPkg.FIXTURE_PPPOE_SESSIONS).toBeDefined();
    expect(mikrotikPkg.FIXTURE_BGP_SESSIONS).toBeDefined();
  });
});
