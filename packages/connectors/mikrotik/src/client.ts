import type {
  IMikrotikConnector,
  MikrotikSystemResource,
  MikrotikInterface,
  MikrotikSfpOpticalMetrics,
  MikrotikPppoeSession,
  MikrotikBgpSession,
} from './types';
import {
  NMS_REQUEST_TIMEOUT_MS,
  assertSafeNmsRequestUrl,
} from '@ftth-copilot/connectors-core';
import {
  FIXTURE_SYSTEM_RESOURCE,
  FIXTURE_INTERFACES,
  FIXTURE_SFP_METRICS,
  FIXTURE_PPPOE_SESSIONS,
  FIXTURE_BGP_SESSIONS,
} from './fixtures';

export interface MikrotikClientOptions {
  useMock: boolean;
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  useTls?: boolean;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class MikrotikClient implements IMikrotikConnector {
  readonly providerName = 'mikrotik';

  private readonly useMock: boolean;
  private readonly host?: string;
  private readonly port?: number;
  private readonly username?: string;
  private readonly password?: string;
  private readonly useTls: boolean;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly skipDnsValidation: boolean;

  constructor(opts: MikrotikClientOptions) {
    this.useMock = opts.useMock;
    this.host = opts.host;
    this.port = opts.port;
    this.username = opts.username;
    this.password = opts.password;
    this.useTls = opts.useTls ?? true;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? NMS_REQUEST_TIMEOUT_MS;
    this.skipDnsValidation = opts.fetchImpl !== undefined;
  }

  private getBaseUrl(): string {
    if (!this.host) {
      throw new Error('MikroTik API requires host configuration');
    }
    const protocol = this.useTls ? 'https' : 'http';
    const portSuffix = this.port ? `:${this.port}` : '';
    return `${protocol}://${this.host}${portSuffix}`;
  }

  private async realFetch<T>(
    path: string,
    options?: { method?: 'GET' | 'POST'; body?: unknown },
  ): Promise<T> {
    if (!this.username || !this.password) {
      throw new Error('MikroTik API requires username and password');
    }

    const baseUrl = this.getBaseUrl();
    const url = await assertSafeNmsRequestUrl(baseUrl, path, {
      resolveDns: !this.skipDnsValidation,
    });

    const auth = Buffer.from(`${this.username}:${this.password}`).toString('base64');
    const headers: Record<string, string> = {
      Authorization: `Basic ${auth}`,
      Accept: 'application/json',
    };

    if (options?.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    const method = options?.method ?? 'GET';
    const res = await this.fetchImpl(url, {
      method,
      headers,
      body: options?.body ? JSON.stringify(options.body) : undefined,
      redirect: 'error',
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!res.ok) {
      throw new Error(`MikroTik API HTTP ${res.status}: ${res.statusText}`);
    }

    return (await res.json()) as T;
  }

  async ping(): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
    if (this.useMock) {
      return { ok: true, latencyMs: 2 };
    }

    const start = performance.now();
    try {
      await this.realFetch<unknown>('/rest/system/resource');
      const latencyMs = Math.round(performance.now() - start);
      return { ok: true, latencyMs };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Unknown connection error',
      };
    }
  }

  async getSystemResource(): Promise<MikrotikSystemResource> {
    if (this.useMock) {
      return FIXTURE_SYSTEM_RESOURCE;
    }

    const raw = await this.realFetch<Record<string, unknown>>('/rest/system/resource');

    // Attempt to gather health sensors (temperature/voltage) if supported
    let temperatureCelsius: number | undefined;
    let voltageVolts: number | undefined;

    try {
      const health = await this.realFetch<Array<Record<string, unknown>>>('/rest/system/health');
      if (Array.isArray(health)) {
        for (const item of health) {
          const name = String(item.name ?? '').toLowerCase();
          const val = parseFloat(String(item.value ?? 'NaN'));
          if (!Number.isNaN(val)) {
            if (name.includes('temp')) temperatureCelsius = val;
            if (name.includes('volt')) voltageVolts = val;
          }
        }
      }
    } catch {
      // Health endpoint is optional on some RouterBOARD platforms
    }

    return {
      uptime: String(raw['uptime'] ?? ''),
      version: String(raw['version'] ?? ''),
      buildTime: String(raw['build-time'] ?? ''),
      freeMemory: Number(raw['free-memory'] ?? 0),
      totalMemory: Number(raw['total-memory'] ?? 0),
      cpu: String(raw['cpu'] ?? ''),
      cpuCount: Number(raw['cpu-count'] ?? 1),
      cpuFrequency: Number(raw['cpu-frequency'] ?? 0),
      cpuLoad: Number(raw['cpu-load'] ?? 0),
      freeHddSpace: Number(raw['free-hdd-space'] ?? 0),
      totalHddSpace: Number(raw['total-hdd-space'] ?? 0),
      architectureName: String(raw['architecture-name'] ?? ''),
      boardName: String(raw['board-name'] ?? ''),
      platform: String(raw['platform'] ?? 'MikroTik'),
      temperatureCelsius,
      voltageVolts,
    };
  }

  async listInterfaces(filter?: {
    runningOnly?: boolean;
    type?: string;
  }): Promise<MikrotikInterface[]> {
    if (this.useMock) {
      return FIXTURE_INTERFACES.filter((iface) => {
        if (filter?.runningOnly && !iface.running) return false;
        if (filter?.type && iface.type !== filter.type) return false;
        return true;
      });
    }

    const rawList = await this.realFetch<Array<Record<string, unknown>>>('/rest/interface');
    const parsed: MikrotikInterface[] = rawList.map((item) => {
      const running = item['running'] === true || item['running'] === 'true';
      const disabled = item['disabled'] === true || item['disabled'] === 'true';
      return {
        id: String(item['.id'] ?? item['id'] ?? ''),
        name: String(item['name'] ?? ''),
        type: String(item['type'] ?? 'ether'),
        running,
        disabled,
        comment: item['comment'] ? String(item['comment']) : undefined,
        macAddress: item['mac-address'] ? String(item['mac-address']) : undefined,
        mtu: Number(item['mtu'] ?? 1500),
        rxByte: Number(item['rx-byte'] ?? 0),
        txByte: Number(item['tx-byte'] ?? 0),
        rxPacket: Number(item['rx-packet'] ?? 0),
        txPacket: Number(item['tx-packet'] ?? 0),
        rxError: item['rx-error'] !== undefined ? Number(item['rx-error']) : undefined,
        txError: item['tx-error'] !== undefined ? Number(item['tx-error']) : undefined,
        rxDrop: item['rx-drop'] !== undefined ? Number(item['rx-drop']) : undefined,
        txDrop: item['tx-drop'] !== undefined ? Number(item['tx-drop']) : undefined,
        linkDowns: item['link-downs'] !== undefined ? Number(item['link-downs']) : undefined,
      };
    });

    return parsed.filter((iface) => {
      if (filter?.runningOnly && !iface.running) return false;
      if (filter?.type && iface.type !== filter.type) return false;
      return true;
    });
  }

  async getSfpOpticalMetrics(interfaceName: string): Promise<MikrotikSfpOpticalMetrics | null> {
    if (this.useMock) {
      return FIXTURE_SFP_METRICS[interfaceName] ?? null;
    }

    try {
      const res = await this.realFetch<Array<Record<string, unknown>>>(
        '/rest/interface/ethernet/monitor',
        {
          method: 'POST',
          body: { numbers: interfaceName, once: true },
        },
      );

      const mon = Array.isArray(res) ? res[0] : res;
      if (!mon) return null;

      const parseNum = (val: unknown): number | undefined => {
        if (val === undefined || val === null || val === '') return undefined;
        const num = parseFloat(String(val));
        return Number.isNaN(num) ? undefined : num;
      };

      return {
        interfaceName,
        sfpRxPowerDbm: parseNum(mon['sfp-rx-power']),
        sfpTxPowerDbm: parseNum(mon['sfp-tx-power']),
        sfpTemperatureCelsius: parseNum(mon['sfp-temperature']),
        sfpVoltageVolts: parseNum(mon['sfp-supply-voltage']),
        sfpCurrentMa: parseNum(mon['sfp-bias-current']),
        sfpWavelengthNm: parseNum(mon['sfp-wavelength']),
        vendorName: mon['sfp-vendor-name'] ? String(mon['sfp-vendor-name']) : undefined,
        vendorPartNumber: mon['sfp-vendor-part-number']
          ? String(mon['sfp-vendor-part-number'])
          : undefined,
        vendorSerial: mon['sfp-vendor-serial'] ? String(mon['sfp-vendor-serial']) : undefined,
      };
    } catch {
      return null;
    }
  }

  async listPppoeSessions(filter?: { username?: string }): Promise<MikrotikPppoeSession[]> {
    if (this.useMock) {
      return FIXTURE_PPPOE_SESSIONS.filter((sess) => {
        if (filter?.username && !sess.name.toLowerCase().includes(filter.username.toLowerCase())) {
          return false;
        }
        return true;
      });
    }

    const rawList = await this.realFetch<Array<Record<string, unknown>>>('/rest/ppp/active');
    const sessions: MikrotikPppoeSession[] = rawList.map((item) => ({
      id: String(item['.id'] ?? item['id'] ?? ''),
      name: String(item['name'] ?? ''),
      service: String(item['service'] ?? 'pppoe'),
      callerId: String(item['caller-id'] ?? item['callerId'] ?? ''),
      address: String(item['address'] ?? ''),
      uptime: String(item['uptime'] ?? ''),
      encoding: item['encoding'] ? String(item['encoding']) : undefined,
      sessionId: String(item['session-id'] ?? item['sessionId'] ?? ''),
      radius: item['radius'] === true || item['radius'] === 'true',
    }));

    return sessions.filter((sess) => {
      if (filter?.username && !sess.name.toLowerCase().includes(filter.username.toLowerCase())) {
        return false;
      }
      return true;
    });
  }

  async listBgpSessions(): Promise<MikrotikBgpSession[]> {
    if (this.useMock) {
      return FIXTURE_BGP_SESSIONS;
    }

    const rawList = await this.realFetch<Array<Record<string, unknown>>>('/rest/routing/bgp/session');
    return rawList.map((item) => {
      const remoteAs = Number(item['remote.as'] ?? 0);
      const localAs = item['local.as'] ? Number(item['local.as']) : undefined;
      const prefixCount =
        item['prefix-count'] !== undefined ? Number(item['prefix-count']) : undefined;

      return {
        id: String(item['.id'] ?? item['id'] ?? ''),
        name: String(item['name'] ?? ''),
        remoteAddress: String(item['remote.address'] ?? item['remoteAddress'] ?? ''),
        remoteAs,
        localAddress: item['local.address'] ? String(item['local.address']) : undefined,
        localAs,
        state: String(item['state'] ?? 'unknown'),
        uptime: item['uptime'] ? String(item['uptime']) : undefined,
        prefixCount,
        holdTime: item['hold-time'] ? String(item['hold-time']) : undefined,
        keepaliveTime: item['keepalive-time'] ? String(item['keepalive-time']) : undefined,
      };
    });
  }
}
