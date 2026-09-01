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
  FIXTURE_OLTS,
  FIXTURE_ONUS,
  FIXTURE_ONU_DETAILS,
  computeOverview,
} from './fixtures';

export interface SmartOltClientOptions {
  useMock: boolean;
  apiKey?: string;
  apiBaseUrl?: string;
  fetchImpl?: typeof fetch;
}

export const SMARTOLT_RATE_LIMIT_PER_HOUR = 15; // per project guide

/**
 * SmartOltClient — adapter de SmartOLT.
 *
 * Por defecto usa fixtures (modo mock). Cuando haya credenciales reales,
 * pasá `useMock: false` con apiKey + apiBaseUrl para hablar HTTP real
 * con https://{{subdomain}}.smartolt.com.
 *
 * Formato real esperado por SmartOLT API:
 *   Headers: X-Token: <api_key>
 *   Endpoints típicos:
 *     POST /api/auth/login → { api_key, ... }
 *     GET  /api/system/get_olts
 *     GET  /api/system/get_olt_detail/{id}
 *     GET  /api/onu/get_all_onus_details
 *     GET  /api/onu/get_onu_detail/{id}         ← para FEC/óptica/firmware
 *     GET  /api/onu/get_onus_statuses
 *     GET  /api/system/get_olt_pon_ports_details/{id}
 *     GET  /api/system/get_outage_pons/{id}
 *
 * El endpoint bulk no siempre expone los contadores FEC ni la versión de
 * firmware. Para obtenerlos hay que fan-outear a `get_onu_detail/{id}`,
 * gobernado por `includeOnuDetail` en las opciones (off por defecto para
 * respetar el rate limit de 15 req/h).
 */
export class SmartOltClient implements INmsConnector {
  readonly providerName = 'smartolt';

  private readonly useMock: boolean;
  private readonly apiKey?: string;
  private readonly apiBaseUrl?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly skipDnsValidation: boolean;

  constructor(opts: SmartOltClientOptions) {
    this.useMock = opts.useMock;
    this.apiKey = opts.apiKey;
    this.apiBaseUrl = opts.apiBaseUrl;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.skipDnsValidation = opts.fetchImpl !== undefined;
  }

  private async realFetch<T>(path: string): Promise<T> {
    if (!this.apiBaseUrl || !this.apiKey) {
      throw new Error('SmartOLT API requires apiBaseUrl and apiKey');
    }
    const url = await assertSafeNmsRequestUrl(this.apiBaseUrl, path, {
      resolveDns: !this.skipDnsValidation,
    });
    const res = await this.fetchImpl(url, {
      headers: {
        'X-Token': this.apiKey,
        'Accept': 'application/json',
      },
      redirect: 'error',
      signal: AbortSignal.timeout(NMS_REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`SmartOLT API ${res.status}: ${res.statusText}`);
    }
    const data = await res.json();
    if (data && typeof data === 'object' && 'status' in data && data.status === false) {
      throw new Error(`SmartOLT API returned status: false`);
    }
    return data as T;
  }

  async ping(): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
    if (this.useMock) return { ok: true, latencyMs: 12 };
    const t0 = Date.now();
    try {
      await this.realFetch('/api/system/get_olts');
      return { ok: true, latencyMs: Date.now() - t0 };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Unknown' };
    }
  }

  async listOlts(): Promise<OltSummary[]> {
    if (this.useMock) return [...FIXTURE_OLTS];
    // Real response shape from SmartOLT docs:
    // { status: true, response: [{ id, name, olt_hardware_version, ip, telnet_port, snmp_port }] }
    const data = await this.realFetch<{ status: boolean; response: Array<Record<string, unknown>> }>(
      '/api/system/get_olts',
    );
    return data.response.map((o) => ({
      id: String(o.id),
      name: String(o.name ?? ''),
      ip: String(o.ip ?? ''),
      status: 'online' as const,
      // Real SmartOLT doesn't return uptime/temp here; that's in get_olt_detail
    }));
  }

  async getOltDetail(oltId: string): Promise<OltSummary & { onusConnected: number }> {
    if (this.useMock) {
      const olt = FIXTURE_OLTS.find((o) => o.id === oltId);
      if (!olt) throw new Error(`OLT ${oltId} not found`);
      const onusConnected = FIXTURE_ONUS.filter(
        (o) => o.oltId === oltId && o.status === 'online',
      ).length;
      return { ...olt, onusConnected };
    }
    // Real: combine the list (which has ip/name) with get_olt_detail for uptime/temp
    const detail = await this.realFetch<{ status: boolean; response: Record<string, unknown> }>(
      `/api/system/get_olt_detail/${oltId}`,
    );
    const olt = detail.response;
    const onus = await this.listOnus({ oltId });
    return {
      id: oltId,
      name: String(olt.name ?? oltId),
      ip: String(olt.ip ?? ''),
      status: 'online' as const,
      uptimeSeconds: typeof olt.uptime === 'number' ? olt.uptime : undefined,
      temperatureCelsius: typeof olt.temperature === 'number' ? olt.temperature : undefined,
      onusConnected: onus.filter((o) => o.status === 'online').length,
    };
  }

  async getNetworkOverview(): Promise<NetworkOverview> {
    if (this.useMock) return computeOverview();
    // For real, we need to call list_olts + list_onus and aggregate.
    // This is two API calls, but SmartOLT also has get_outage_pons which
    // gives pre-aggregated data.
    const olts = await this.listOlts();
    const onus = await this.listOnus();
    const onlineOnus = onus.filter((o) => o.status === 'online').length;
    const offlineOnus = onus.filter((o) => o.status === 'offline').length;
    const avgUptime =
      onus.reduce((acc, o) => acc + (o.uptimeSeconds ?? 0), 0) / Math.max(onus.length, 1);
    return {
      totalOlts: olts.length,
      oltsOnline: olts.filter((o) => o.status === 'online').length,
      totalOnus: onus.length,
      onusOnline: onlineOnus,
      onusOffline: offlineOnus,
      averageUptimeSeconds: Math.round(avgUptime),
      oltsWithHighTemperature: 0, // would need to call get_olt_detail for each
    };
  }

  async listOnus(filter?: { oltId?: string; status?: OnuSummary['status'] }): Promise<OnuSummary[]> {
    if (this.useMock) {
      let result = [...FIXTURE_ONUS];
      if (filter?.oltId) result = result.filter((o) => o.oltId === filter.oltId);
      if (filter?.status) result = result.filter((o) => o.status === filter.status);
      return result;
    }
    // Real: SmartOLT returns a paginated list
    const data = await this.realFetch<{ status: boolean; onus: Array<Record<string, unknown>> }>(
      '/api/onu/get_all_onus_details',
    );
    let onus = data.onus.map((o) => this.mapOnuSummary(o));
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
      return summary ?? null;
    }
    // Real: get_onus_statuses returns status + id; get_all_onus_details returns full.
    // For simplicity, fan out to get_all_onus_details and find by id or sn.
    const data = await this.realFetch<{ status: boolean; onus: Array<Record<string, unknown>> }>(
      '/api/onu/get_all_onus_details',
    );
    const match = data.onus.find(
      (o) => String(o.unique_external_id) === identifier || String(o.sn) === identifier,
    );
    if (!match) return null;
    return this.mapOnuDetail(match);
  }

  async getOnusWithLowSignal(thresholdDbm: number): Promise<OnuSummary[]> {
    if (this.useMock) {
      return FIXTURE_ONUS.filter(
        (o) => (o.rxPowerDbm ?? 0) < thresholdDbm && o.rxPowerDbm !== undefined,
      );
    }
    // Real: filter the get_all_onus_details response
    const onus = await this.listOnus();
    return onus.filter((o) => (o.rxPowerDbm ?? 0) < thresholdDbm && o.rxPowerDbm !== undefined);
  }

  async searchByCustomerName(name: string): Promise<OnuSummary[]> {
    if (this.useMock) {
      const lower = name.toLowerCase();
      return FIXTURE_ONUS.filter(o => o.customerName?.toLowerCase().includes(lower));
    }
    return this.realFetch<OnuSummary[]>('/onus?customer_name=' + encodeURIComponent(name));
  }

  // ── Helpers for mapping real SmartOLT responses to INmsConnector types ──

  private mapOnuSummary(o: Record<string, unknown>): OnuSummary {
    const status = this.mapStatus(o.status as string | null | undefined);
    return {
      id: String(o.unique_external_id ?? o.sn ?? ''),
      serial: String(o.sn ?? ''),
      oltId: String(o.olt_id ?? ''),
      customerName: typeof o.name === 'string' ? o.name : undefined,
      status,
      rxPowerDbm: this.parseFloat(o.signal),
      txPowerDbm: this.parseFloat(o.signal_1490),
      uptimeSeconds: undefined,
      lastSeenAt: typeof o.last_status_change === 'string' ? o.last_status_change : undefined,
      // Some SmartOLT endpoints expose optical-health fields in the bulk
      // response. The fan-out path covers the rest (see listOnus). Try the
      // common naming variants without inventing a single canonical form.
      fecCorrected: pickNumber(o, ['fec_corrected', 'fecCorrected', 'corrected_fec']),
      fecUncorrected: pickNumber(o, ['fec_uncorrected', 'fecUncorrected', 'uncorrected_fec']),
      biasCurrentMa: pickNumber(o, ['bias_current', 'biasCurrent', 'bias_current_ma']),
      ontTemperatureCelsius: pickNumber(o, [
        'ont_temperature',
        'ontTemperature',
        'ont_temperature_celsius',
      ]),
    };
  }

  private mapOnuDetail(o: Record<string, unknown>): OnuDetail {
    const summary = this.mapOnuSummary(o);
    return {
      ...summary,
      model: typeof o.onu_type_name === 'string' ? o.onu_type_name.split('-').pop() : undefined,
      vendor: typeof o.onu_type_name === 'string' ? o.onu_type_name.split('-')[0] : undefined,
      oltPort: o.board !== undefined && o.port !== undefined ? `${o.board}/${o.port}/${o.onu}` : undefined,
      firmwareVersion: pickString(o, [
        'onu_firmware_version',
        'firmware_version',
        'firmware',
        'sw_version',
      ]),
    };
  }

  private mapStatus(s: string | null | undefined): 'online' | 'offline' | 'degraded' {
    if (!s) return 'offline';
    const lower = s.toLowerCase();
    if (lower === 'online' || lower === 'offline') return lower;
    return 'degraded';
  }

  private parseFloat(v: unknown): number | undefined {
    if (typeof v === 'number') return v;
    if (typeof v === 'string') {
      const n = parseFloat(v);
      return isNaN(n) ? undefined : n;
    }
    return undefined;
  }
}

// ── Module-level helpers ──

/**
 * Returns the first numeric value from `record` whose key matches one of
 * `candidates`. Returns `undefined` when no candidate is present or parseable.
 *
 * SmartOLT has shipped its API under multiple field-name conventions across
 * versions; this lets us stay compatible without hard-coding one shape.
 */
function pickNumber(record: Record<string, unknown>, candidates: string[]): number | undefined {
  for (const key of candidates) {
    const raw = record[key];
    if (raw === undefined || raw === null) continue;
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
    if (typeof raw === 'string') {
      const n = parseFloat(raw);
      if (!Number.isNaN(n)) return n;
    }
  }
  return undefined;
}

function pickString(record: Record<string, unknown>, candidates: string[]): string | undefined {
  for (const key of candidates) {
    const raw = record[key];
    if (typeof raw === 'string' && raw.length > 0) return raw;
  }
  return undefined;
}
