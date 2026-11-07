import type {
  INmsConnector,
  OltSummary,
  OltDetail,
  OnuSummary,
  OnuDetail,
  NetworkOverview,
  OdnComponent,
} from '@ftth-copilot/connectors-core';
import {
  NMS_REQUEST_TIMEOUT_MS,
  assertSafeNmsRequestUrl,
} from '@ftth-copilot/connectors-core';
import {
  FIXTURE_ROUTERS,
  FIXTURE_ONUS,
  FIXTURE_ONU_DETAILS,
  FIXTURE_CLIENTES,
  FIXTURE_ODBS,
  computeOverview,
} from './fixtures';
import type { MikrowispCliente, MikrowispOdb, MikrowispRouter } from './fixtures';
import {
  parseMikrowispClientes,
  parseMikrowispMonitoreo,
  parseMikrowispOdbs,
  parseMikrowispRouters,
  type MikrowispEnvelope,
} from './schemas';

/**
 * El `id` que pide "todos" en `GetRouters` y `GetMonitoreo`.
 *
 * Los dos endpoints documentan `id` como obligatorio y su descripción dice
 * que `-1` lista todos: es el valor que corresponde a `listOlts()` y
 * `listOnus()`.
 */
const ALL_DEVICES_ID = -1;

/** Los estados de cliente que documenta la API. */
const CLIENTE_ESTADOS = ['ACTIVO', 'SUSPENDIDO', 'RETIRADO'] as const;

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

  /**
   * Una llamada HTTP, con el cuerpo validado en el borde.
   *
   * El token viaja en el cuerpo (es lo que documenta la API) y nunca aparece
   * en un mensaje de error.
   */
  private async realFetch<T extends MikrowispEnvelope>(
    path: string,
    parse: (data: unknown, endpoint: string) => T,
    extraBody?: Record<string, unknown>,
  ): Promise<T> {
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
      throw new Error(`Mikrowisp API ${res.status}: ${res.statusText} (${path})`);
    }
    const parsed = parse((await res.json()) as unknown, path);
    if (parsed.estado !== undefined && parsed.estado !== 'exito') {
      throw new Error(`Mikrowisp API error: ${parsed.mensaje ?? parsed.estado}`);
    }
    if (parsed.code !== undefined && parsed.code !== '200') {
      throw new Error(`Mikrowisp API error code ${parsed.code}: ${parsed.mensaje ?? ''}`);
    }
    return parsed;
  }

  // ── INmsConnector implementation ──

  async ping(): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
    if (this.useMock) return { ok: true, latencyMs: 18 };
    const t0 = Date.now();
    try {
      await this.realFetch('/GetRouters', parseMikrowispRouters, { id: ALL_DEVICES_ID });
      return { ok: true, latencyMs: Date.now() - t0 };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Unknown' };
    }
  }

  async listOlts(): Promise<OltSummary[]> {
    if (this.useMock) {
      return FIXTURE_ROUTERS.map((r) => this.mapRouterToOlt(r));
    }
    const data = await this.realFetch('/GetRouters', parseMikrowispRouters, {
      id: ALL_DEVICES_ID,
    });
    return data.routers.map((r) => this.mapRouterToOltRaw(r));
  }

  async getOltDetail(oltId: string): Promise<OltDetail> {
    if (this.useMock) {
      const router = FIXTURE_ROUTERS.find((r) => r.id === oltId);
      if (!router) throw new Error(`Router/OLT ${oltId} not found`);
      const subscribersConnected = FIXTURE_ONUS.filter(
        (o) => o.status === 'online',
      ).length;
      return {
        ...this.mapRouterToOlt(router),
        subscribersConnected,
        model: router.modelo,
        ponTechnology: 'GPON',
        maxSubscribers: 256,
      };
    }
    const data = await this.realFetch('/GetRouters', parseMikrowispRouters, {
      id: ALL_DEVICES_ID,
    });
    const match = data.routers.find((r) => String(r['id']) === oltId);
    if (!match) throw new Error(`Router/OLT ${oltId} not found`);
    const olt = this.mapRouterToOltRaw(match);
    const onus = await this.listOnus();
    return {
      ...olt,
      subscribersConnected: onus.filter((o) => o.status === 'online').length,
    };
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
    const data = await this.realFetch('/GetMonitoreo', parseMikrowispMonitoreo, {
      id: ALL_DEVICES_ID,
    });
    let onus = data.equipos.map((e) => this.mapEquipoToOnu(e));
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
    const data = await this.realFetch('/GetMonitoreo', parseMikrowispMonitoreo, {
      id: ALL_DEVICES_ID,
    });
    const match = data.equipos.find((e) => String(e['id']) === identifier);
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

  async listOnusByOlt(oltId: string): Promise<OnuDetail[]> {
    throw new Error(
      'listOnusByOlt is not supported by Mikrowisp. Use listOnus({ oltId }) instead.',
    );
  }

  // ── Mikrowisp-specific methods ──

  async listRouters(): Promise<MikrowispRouter[]> {
    if (this.useMock) return [...FIXTURE_ROUTERS];
    const data = await this.realFetch('/GetRouters', parseMikrowispRouters, {
      id: ALL_DEVICES_ID,
    });
    return data.routers.map((r) => this.mapRouterRow(r));
  }

  async listClients(filter?: { status?: MikrowispCliente['estado'] }): Promise<MikrowispCliente[]> {
    if (this.useMock) {
      let result = [...FIXTURE_CLIENTES];
      if (filter?.status) result = result.filter((c) => c.estado === filter.status);
      return result;
    }
    const data = await this.realFetch('/GetAllClients', parseMikrowispClientes);
    let clientes = data.clientes.map((c) => this.mapClienteRow(c));
    if (filter?.status) clientes = clientes.filter((c) => c.estado === filter.status);
    return clientes;
  }

  async getOdbList(): Promise<MikrowispOdb[]> {
    if (this.useMock) return [...FIXTURE_ODBS];
    const data = await this.realFetch('/SmartOltGetODB', parseMikrowispOdbs);
    return data.odbs.map((o) => this.mapOdbRow(o));
  }

  /**
   * Map Mikrowisp ODB rows to canonical OdnComponent entries (Fase ODN-2).
   *
   * In Mikrowisp, an "ODB" (Optical Distribution Box) is operator-side terminology
   * for a Network Access Point (NAP) — the outdoor cabinet where the fiber
   * distribution segment terminates. Each NAP is parented to a router/OLT
   * via the optional `olt_id` field.
   *
   * The mapping is conservative: if `nombre_odb` does not match the NAP pattern
   * (e.g. starts with a different prefix), the entry is still surfaced with
   * the id as label so downstream consumers can decide.
   */
  async getOdnComponents(): Promise<OdnComponent[]> {
    const odbs = await this.getOdbList();
    return odbs.map((odb) => this.mapOdbToOdnComponent(odb));
  }

  private mapOdbToOdnComponent(odb: MikrowispOdb): OdnComponent {
    const label = odb.nombre_odb?.trim() || odb.id;
    // Heuristic: NAP-* (operator convention) or ODB-* (legacy). Default to NAP.
    // Per the evidence-first principle, downstream consumers should confirm
    // the kind against registered topology.
    const kind: OdnComponent['kind'] = /^ODB[-_]/i.test(label) ? 'NAP' : 'NAP';

    return {
      kind,
      id: odb.id,
      label,
      parentId: odb.olt_id,
      splitRatio: odb.split_ratio,
      attenuationDb: odb.atenuacion_db,
      sourceId: 'mikrowisp-odb',
    };
  }

  // ── Mapping helpers ──

  /**
   * Una fila de `GetRouters` a `MikrowispRouter`.
   *
   * El sobre ya lo validó el parser; acá se copian los campos que el tipo
   * declara, con el mismo criterio de siempre: lo que falta queda vacío en vez
   * de inventarse.
   */
  private mapRouterRow(r: Record<string, unknown>): MikrowispRouter {
    return {
      id: String(r['id'] ?? ''),
      nombre: String(r['nombre'] ?? ''),
      ip: String(r['ip'] ?? ''),
      coordenadas: String(r['coordenadas'] ?? ''),
      version: String(r['version'] ?? ''),
      estado: String(r['estado'] ?? ''),
      modelo: String(r['modelo'] ?? ''),
      serial: String(r['serial'] ?? ''),
    };
  }

  private mapClienteRow(c: Record<string, unknown>): MikrowispCliente {
    const estado = String(c['estado'] ?? '');
    const known = (CLIENTE_ESTADOS as readonly string[]).includes(estado);
    return {
      id: String(c['id'] ?? ''),
      nombre: String(c['nombre'] ?? ''),
      // Un estado que la API no documenta no se presenta como activo: cae en
      // el mismo balde que un cliente retirado, que es el lado seguro.
      estado: known ? (estado as MikrowispCliente['estado']) : 'RETIRADO',
      correo: String(c['correo'] ?? ''),
      telefono: String(c['telefono'] ?? ''),
      movil: String(c['movil'] ?? ''),
      cedula: String(c['cedula'] ?? ''),
      direccion_principal: String(c['direccion_principal'] ?? ''),
      servicios: String(c['servicios'] ?? ''),
    };
  }

  private mapOdbRow(o: Record<string, unknown>): MikrowispOdb {
    const splitRatio = pickFiniteNumber(o['split_ratio']);
    const attenuation = pickFiniteNumber(o['atenuacion_db']);
    return {
      id: String(o['id'] ?? ''),
      nombre_odb: String(o['nombre_odb'] ?? ''),
      ...(o['olt_id'] === undefined || o['olt_id'] === null
        ? {}
        : { olt_id: String(o['olt_id']) }),
      ...(splitRatio === undefined ? {} : { split_ratio: splitRatio }),
      ...(attenuation === undefined ? {} : { atenuacion_db: attenuation }),
    };
  }

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
    return this.mapRouterToOlt(this.mapRouterRow(r));
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

/**
 * Un número finito de una fila, aceptando el texto numérico que a veces manda
 * la API. Cualquier otra cosa queda `undefined`.
 */
function pickFiniteNumber(raw: unknown): number | undefined {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' && raw.trim() !== '') {
    const parsed = Number.parseFloat(raw.trim());
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}
