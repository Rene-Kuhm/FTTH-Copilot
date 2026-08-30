import type {
  INmsConnector,
  OltSummary,
  OnuSummary,
  OnuDetail,
  NetworkOverview,
} from '@ftth-copilot/connectors-core';
import {
  NMS_REQUEST_TIMEOUT_MS,
  assertSafeNmsRequestUrl,
} from '@ftth-copilot/connectors-core';
import {
  FIXTURE_ROUTERS,
  FIXTURE_EQUIPOS,
  FIXTURE_ONUS,
  FIXTURE_ONU_DETAILS,
  FIXTURE_CLIENTES,
  FIXTURE_ODBS,
  computeOverview,
} from './fixtures';
import type { MikrowispCliente, MikrowispOdb, MikrowispRouter } from './fixtures';

export interface MikrowispClientOptions {
  useMock: boolean;
  token?: string;
  apiBaseUrl?: string;
  fetchImpl?: typeof fetch;
}

export class MikrowispClient implements INmsConnector {
  readonly providerName = 'mikrowisp';

  private readonly useMock: boolean;
  private readonly token?: string;
  private readonly apiBaseUrl?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly skipDnsValidation: boolean;

  constructor(opts: MikrowispClientOptions) {
    this.useMock = opts.useMock;
    this.token = opts.token;
    this.apiBaseUrl = opts.apiBaseUrl;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.skipDnsValidation = opts.fetchImpl !== undefined;
  }

  private async realFetch<T>(path: string, extraBody?: Record<string, unknown>): Promise<T> {
    if (!this.apiBaseUrl || !this.token) {
      throw new Error('Mikrowisp API requires apiBaseUrl and token');
    }
    const url = await assertSafeNmsRequestUrl(this.apiBaseUrl, path, {
      resolveDns: !this.skipDnsValidation,
    });
    const body = { token: this.token, ...extraBody };
    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(NMS_REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`Mikrowisp API ${res.status}: ${res.statusText}`);
    }
    const data = await res.json();
    if (data && typeof data === 'object') {
      if ('estado' in data && data.estado !== 'exito') {
        const msg = 'mensaje' in data ? String(data.mensaje) : String(data.estado);
        throw new Error(`Mikrowisp API error: ${msg}`);
      }
      if ('code' in data && data.code !== '200') {
        throw new Error(`Mikrowisp API error code ${String(data.code)}: ${String(data.mensaje ?? '')}`);
      }
    }
    return data as T;
  }

  // ── INmsConnector implementation ──

  async ping(): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
    if (this.useMock) return { ok: true, latencyMs: 18 };
    const t0 = Date.now();
    try {
      await this.realFetch('/GetRouters');
      return { ok: true, latencyMs: Date.now() - t0 };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Unknown' };
    }
  }

  async listOlts(): Promise<OltSummary[]> {
    if (this.useMock) {
      return FIXTURE_ROUTERS.map((r) => this.mapRouterToOlt(r));
    }
    const data = await this.realFetch<{ routers: Array<Record<string, unknown>> }>(
      '/GetRouters',
    );
    return (data.routers ?? []).map((r) => this.mapRouterToOltRaw(r));
  }

  async getOltDetail(oltId: string): Promise<OltSummary & { onusConnected: number }> {
    if (this.useMock) {
      const router = FIXTURE_ROUTERS.find((r) => r.id === oltId);
      if (!router) throw new Error(`Router/OLT ${oltId} not found`);
      const onusConnected = FIXTURE_ONUS.filter(
        (o) => o.status === 'online',
      ).length;
      return { ...this.mapRouterToOlt(router), onusConnected };
    }
    const data = await this.realFetch<{ routers: Array<Record<string, unknown>> }>(
      '/GetRouters',
    );
    const match = (data.routers ?? []).find((r) => String(r.id) === oltId);
    if (!match) throw new Error(`Router/OLT ${oltId} not found`);
    const olt = this.mapRouterToOltRaw(match);
    const onus = await this.listOnus();
    return { ...olt, onusConnected: onus.filter((o) => o.status === 'online').length };
  }

  async getNetworkOverview(): Promise<NetworkOverview> {
    if (this.useMock) return computeOverview();
    const rtr = await this.listOlts();
    const eq = await this.listOnus();
    const onlineOnus = eq.filter((o) => o.status === 'online').length;
    const offlineOnus = eq.filter((o) => o.status === 'offline').length;
    const avgUptime =
      eq.reduce((acc, o) => acc + (o.uptimeSeconds ?? 0), 0) / Math.max(eq.length, 1);
    return {
      totalOlts: rtr.length,
      oltsOnline: rtr.filter((o) => o.status === 'online').length,
      totalOnus: eq.length,
      onusOnline: onlineOnus,
      onusOffline: offlineOnus,
      averageUptimeSeconds: Math.round(avgUptime),
      oltsWithHighTemperature: 0,
    };
  }

  async listOnus(filter?: { oltId?: string; status?: OnuSummary['status'] }): Promise<OnuSummary[]> {
    if (this.useMock) {
      let result = [...FIXTURE_ONUS];
      if (filter?.oltId) result = result.filter((o) => o.oltId === filter.oltId);
      if (filter?.status) result = result.filter((o) => o.status === filter.status);
      return result;
    }
    const data = await this.realFetch<{ equipos: Array<Record<string, unknown>> }>(
      '/GetMonitoreo',
    );
    let onus = (data.equipos ?? []).map((e) => this.mapEquipoToOnu(e));
    if (filter?.oltId) onus = onus.filter((o) => o.oltId === filter.oltId);
    if (filter?.status) onus = onus.filter((o) => o.status === filter.status);
    return onus;
  }

  async getOnuDetail(identifier: string): Promise<OnuDetail | null> {
    if (this.useMock) {
      const direct = FIXTURE_ONU_DETAILS[identifier];
      if (direct) return direct;
      const bySerial = Object.values(FIXTURE_ONU_DETAILS).find((o) => o.serial === identifier);
      if (bySerial) return bySerial;
      const summary = FIXTURE_ONUS.find(
        (o) => o.id === identifier || o.serial === identifier,
      );
      if (!summary) return null;
      return { ...summary };
    }
    const data = await this.realFetch<{ equipos: Array<Record<string, unknown>> }>(
      '/GetMonitoreo',
    );
    const match = (data.equipos ?? []).find(
      (e) => String(e.id) === identifier,
    );
    if (!match) return null;
    return { ...this.mapEquipoToOnu(match) };
  }

  async getOnusWithLowSignal(thresholdDbm: number): Promise<OnuSummary[]> {
    if (this.useMock) {
      return FIXTURE_ONUS.filter(
        (o) => (o.rxPowerDbm ?? 0) < thresholdDbm && o.rxPowerDbm !== undefined,
      );
    }
    const onus = await this.listOnus();
    return onus.filter((o) => (o.rxPowerDbm ?? 0) < thresholdDbm && o.rxPowerDbm !== undefined);
  }

  async searchByCustomerName(name: string): Promise<OnuSummary[]> {
    const normalizedName = name.trim().toLocaleLowerCase();
    if (!normalizedName) return [];
    const onus = await this.listOnus();
    return onus.filter((onu) =>
      onu.customerName?.toLocaleLowerCase().includes(normalizedName),
    );
  }

  // ── Mikrowisp-specific methods ──

  async listRouters(): Promise<MikrowispRouter[]> {
    if (this.useMock) return [...FIXTURE_ROUTERS];
    const data = await this.realFetch<{ routers: MikrowispRouter[] }>('/GetRouters');
    return data.routers ?? [];
  }

  async listClients(filter?: { status?: MikrowispCliente['estado'] }): Promise<MikrowispCliente[]> {
    if (this.useMock) {
      let result = [...FIXTURE_CLIENTES];
      if (filter?.status) result = result.filter((c) => c.estado === filter.status);
      return result;
    }
    const data = await this.realFetch<{ clientes: MikrowispCliente[] }>('/GetAllClients');
    let clientes = data.clientes ?? [];
    if (filter?.status) clientes = clientes.filter((c) => c.estado === filter.status);
    return clientes;
  }

  async getOdbList(): Promise<MikrowispOdb[]> {
    if (this.useMock) return [...FIXTURE_ODBS];
    const data = await this.realFetch<{ odbs: MikrowispOdb[] }>('/SmartOltGetODB');
    return data.odbs ?? [];
  }

  // ── Mapping helpers ──

  private mapRouterToOlt(r: MikrowispRouter): OltSummary {
    return {
      id: r.id,
      name: r.nombre,
      ip: r.ip,
      status: r.estado === 'activo' ? 'online' : 'offline',
      uptimeSeconds: undefined,
      temperatureCelsius: undefined,
    };
  }

  private mapRouterToOltRaw(r: Record<string, unknown>): OltSummary {
    return {
      id: String(r.id ?? ''),
      name: String(r.nombre ?? ''),
      ip: String(r.ip ?? ''),
      status: String(r.estado ?? '') === 'activo' ? 'online' : 'offline',
      uptimeSeconds: undefined,
      temperatureCelsius: undefined,
    };
  }

  private mapEquipoToOnu(e: Record<string, unknown>): OnuSummary {
    return {
      id: String(e.id ?? ''),
      serial: `SNMW-${String(e.id ?? '')}`,
      oltId: String(e.ip ?? ''),
      customerName: typeof e.nombre === 'string' ? e.nombre : undefined,
      status: e.estado === 1 ? 'online' : 'offline',
      rxPowerDbm: undefined,
      txPowerDbm: undefined,
      // The monitoring response does not expose uptime or last-seen; leave
      // them undefined instead of fabricating placeholder values.
      uptimeSeconds: undefined,
      lastSeenAt: undefined,
    };
  }
}
