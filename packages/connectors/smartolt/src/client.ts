import type {
  INmsConnector,
  OltSummary,
  OltDetail,
  OnuSummary,
  OnuDetail,
  NetworkOverview,
  PonTechnology,
  OltFormFactor,
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
import {
  SmartoltPaginationLimitError,
  SmartoltRateLimitError,
  SmartoltResponseShapeError,
} from './errors';
import {
  SMARTOLT_DEFAULT_RATE_LIMIT,
  SmartoltRateGovernor,
  readRateLimitBody,
  readRetryAfterSeconds,
  resolveSmartoltRateLimitConfig,
  type SmartoltRateLimitConfig,
  type SmartoltRateLimitOverrides,
} from './rate-limit';
import {
  getAccountRateGovernor,
  smartoltAccountKey,
} from './rate-limit-registry';
import {
  parseOltUptimeResponse,
  parseOltsResponse,
  parseOnusPageResponse,
  parseStatusEnvelope,
} from './schemas';

export interface SmartOltClientOptions {
  useMock: boolean;
  apiKey?: string;
  apiBaseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Pisa el presupuesto de llamadas que sale del entorno. */
  rateLimit?: SmartoltRateLimitOverrides;
  /** Tope de páginas por llamada de inventario. Default `SMARTOLT_MAX_PAGES` (50). */
  maxPages?: number;
  /**
   * Reloj y `sleep` inyectables: los tests no duermen de verdad.
   *
   * Un cliente con reloj propio no comparte el presupuesto de la cuenta: el
   * contador pertenece al reloj con el que se mide, y un test con tiempo falso
   * no puede mover la ventana del proceso.
   */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Guardia ya construido, para compartirlo explícitamente. */
  governor?: SmartoltRateGovernor;
  /** Fuente de entorno para el presupuesto y el tope de páginas. */
  env?: NodeJS.ProcessEnv;
}

/** Lo que se le puede pedir a un listado paginado de ONUs. */
export interface SmartoltListOnusOptions {
  /**
   * Trae sólo las ONUs cuya configuración cambió desde esa fecha
   * (`YYYY-MM-DD HH:MM:SS`, ver `formatUpdatedSince`). Es el modo incremental:
   * una o dos llamadas en vez de paginar el inventario entero.
   */
  updatedSince?: string;
  /** Ítems por página, 1-100 (default 100, el máximo que acepta la API). */
  pageSize?: number;
  /** Tope de páginas para esta llamada. */
  maxPages?: number;
}

/**
 * El presupuesto de llamadas por defecto, en llamadas por hora.
 *
 * @deprecated La cuenta tiene 1.000 llamadas por hora por defecto (no 15: ese
 * es el tope del export completo de ONUs). Usá `rateLimit.perHour` del cliente
 * o la variable `SMARTOLT_RATE_LIMIT_PER_HOUR`. Se mantiene exportada para no
 * romper a quien la importe.
 */
export const SMARTOLT_RATE_LIMIT_PER_HOUR = SMARTOLT_DEFAULT_RATE_LIMIT.perHour;

/** El tope de páginas por llamada cuando nada dice otra cosa. */
export const DEFAULT_SMARTOLT_MAX_PAGES = 50;

/** El tamaño de página que pide el conector (el máximo que acepta la API). */
const ONUS_PAGE_SIZE = 100;

/** Espera por defecto de un 429 que no dice cuánto esperar. */
const DEFAULT_RETRY_DELAY_MS = 1_000;

/**
 * El tope de páginas de una llamada de inventario, del entorno si está.
 *
 * Un presupuesto que no sea un entero positivo se ignora: el conector prefiere
 * paginar de más antes que quedarse sin leer el inventario.
 */
export function resolveSmartoltMaxPages(env: NodeJS.ProcessEnv = process.env): number {
  const raw = (env['SMARTOLT_MAX_PAGES'] ?? '').trim();
  if (!/^\d+$/.test(raw)) return DEFAULT_SMARTOLT_MAX_PAGES;
  const parsed = Number.parseInt(raw, 10);
  return parsed > 0 ? parsed : DEFAULT_SMARTOLT_MAX_PAGES;
}

/** `2026-07-08T12:00:00Z` → `2026-07-08 12:00:00`, el formato de `updated_since`. */
export function formatUpdatedSince(when: Date): string {
  const iso = when.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)}`;
}

/**
 * SmartOltClient — adapter de SmartOLT.
 *
 * Por defecto usa fixtures (modo mock). Cuando haya credenciales reales,
 * pasá `useMock: false` con apiKey + apiBaseUrl para hablar HTTP real
 * con https://{{subdomain}}.smartolt.com.
 *
 * Formato real esperado por SmartOLT API (octubre 2026):
 *   Headers: X-Token: <api_key>
 *   Endpoints que usa el conector:
 *     GET  /api/system/get_zones                  ← ping (get_olts NO es un heartbeat)
 *     GET  /api/system/get_olts
 *     GET  /api/olt/get_olt_uptime_and_env_temperature/{olt_id}
 *     GET  /api/onu/get_all_onus_details?page=N&page_size=100[&updated_since=...]
 *
 * Presupuesto: 1.000 llamadas por hora y 15 por segundo, configurables con
 * `SMARTOLT_RATE_LIMIT_PER_HOUR` / `SMARTOLT_RATE_LIMIT_PER_SECOND`. Un 429 se
 * respeta con `Retry-After` hasta `SMARTOLT_MAX_RETRY_AFTER_MS`; pasado ese
 * tope, el cliente falla con `SmartoltRateLimitError` en vez de dormir.
 *
 * El endpoint bulk sin `page` es un export completo del inventario: 15
 * llamadas por hora y bloqueo al llegar al límite. Por eso el conector pagina
 * siempre.
 *
 * El endpoint bulk no siempre expone los contadores FEC ni la versión de
 * firmware. Para obtenerlos hay que fan-outear a `get_onu_details/{id}`, que
 * hoy no se usa: cada llamada sale del mismo presupuesto.
 */
export class SmartOltClient implements INmsConnector {
  readonly providerName = 'smartolt';

  private readonly useMock: boolean;
  private readonly apiKey?: string;
  private readonly apiBaseUrl?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly skipDnsValidation: boolean;
  private readonly rateLimitConfig: SmartoltRateLimitConfig;
  private readonly governor: SmartoltRateGovernor;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxPages: number;

  constructor(opts: SmartOltClientOptions) {
    this.useMock = opts.useMock;
    this.apiKey = opts.apiKey;
    this.apiBaseUrl = opts.apiBaseUrl;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.skipDnsValidation = opts.fetchImpl !== undefined;

    this.rateLimitConfig = resolveSmartoltRateLimitConfig(opts.env, opts.rateLimit);
    this.sleep =
      opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

    // El presupuesto es de la cuenta, no de la instancia: el scheduler arma un
    // cliente nuevo en cada tick y un guardia local reiniciaba el contador en
    // cada arranque. Con el registro, dos instancias de la misma cuenta gastan
    // la misma ventana. Un cliente con reloj inyectado queda fuera del registro
    // porque su ventana la mueve un reloj que no es el del proceso.
    const clock =
      opts.now === undefined && opts.sleep === undefined
        ? {}
        : {
            ...(opts.now === undefined ? {} : { now: opts.now }),
            sleep: this.sleep,
          };
    this.governor =
      opts.governor ??
      (opts.now === undefined && opts.sleep === undefined && this.apiKey && this.apiBaseUrl
        ? getAccountRateGovernor(
            smartoltAccountKey({ apiBaseUrl: this.apiBaseUrl, apiKey: this.apiKey }),
            this.rateLimitConfig,
            clock,
          )
        : new SmartoltRateGovernor(this.rateLimitConfig, clock));
    this.maxPages = opts.maxPages ?? resolveSmartoltMaxPages(opts.env);
  }

  /**
   * Una llamada HTTP, con presupuesto, `Retry-After` respetado y parseo del
   * borde.
   *
   * Nunca incluye el `X-Token` en el error: el token viaja sólo en el header.
   */
  private async realFetch<T extends { status: boolean }>(
    path: string,
    parse: (data: unknown, endpoint: string) => T,
  ): Promise<T> {
    if (!this.apiBaseUrl || !this.apiKey) {
      throw new Error('SmartOLT API requires apiBaseUrl and apiKey');
    }
    const url = await assertSafeNmsRequestUrl(this.apiBaseUrl, path, {
      resolveDns: !this.skipDnsValidation,
    });
    const endpoint = path.split('?')[0] ?? path;
    const maxAttempts = this.rateLimitConfig.maxRetries + 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await this.governor.beforeRequest(endpoint);
      const res = await this.fetchImpl(url, {
        headers: {
          'X-Token': this.apiKey,
          'Accept': 'application/json',
        },
        redirect: 'error',
        signal: AbortSignal.timeout(NMS_REQUEST_TIMEOUT_MS),
      });
      this.governor.observeResponse(res.headers, endpoint);

      if (res.status === 429) {
        const headerSeconds = readRetryAfterSeconds(res.headers);
        const body = readRateLimitBody(await readJsonOrUndefined(res));
        const retryAfterSeconds = headerSeconds ?? body.retryAfterSeconds;
        const violationType = body.violationType;
        const waitMs =
          retryAfterSeconds === undefined ? DEFAULT_RETRY_DELAY_MS : retryAfterSeconds * 1_000;

        if (waitMs > this.rateLimitConfig.maxRetryAfterMs) {
          throw new SmartoltRateLimitError(
            `SmartOLT pidió esperar ${Math.ceil(waitMs / 1_000)}s en ${endpoint} y el tope de ` +
              `espera es ${Math.round(this.rateLimitConfig.maxRetryAfterMs / 1_000)}s.`,
            {
              ...(violationType === undefined ? {} : { violationType }),
              ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
              endpoint,
              attempts: attempt - 1,
            },
          );
        }
        if (attempt >= maxAttempts) {
          throw new SmartoltRateLimitError(
            `SmartOLT siguió limitando las llamadas a ${endpoint} después de ${attempt} intentos` +
              (retryAfterSeconds === undefined ? '.' : ` (Retry-After: ${retryAfterSeconds}s).`),
            {
              ...(violationType === undefined ? {} : { violationType }),
              ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
              endpoint,
              attempts: attempt,
            },
          );
        }

        await this.sleep(waitMs);
        continue;
      }

      if (!res.ok) {
        throw new Error(`SmartOLT API ${res.status}: ${res.statusText} (${endpoint})`);
      }

      const parsed = parse(await readJsonOrUndefined(res), endpoint);
      if (parsed.status === false) {
        throw new Error(`SmartOLT API returned status: false (${endpoint})`);
      }
      return parsed;
    }

    // Inalcanzable: el bucle devuelve o tira en cada rama.
    throw new SmartoltRateLimitError(`SmartOLT no respondió a ${endpoint}`, {
      endpoint,
      attempts: maxAttempts,
    });
  }

  async ping(): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
    if (this.useMock) return { ok: true, latencyMs: 12 };
    const t0 = Date.now();
    try {
      // `get_olts` está prohibido como heartbeat por la propia API: hay
      // integraciones que lo martillan y el proveedor lo detecta. `get_zones`
      // es una lista chica y barata.
      await this.realFetch('/api/system/get_zones', parseStatusEnvelope);
      return { ok: true, latencyMs: Date.now() - t0 };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Unknown' };
    }
  }

  async listOlts(): Promise<OltSummary[]> {
    if (this.useMock) return [...FIXTURE_OLTS];
    // Real response shape from SmartOLT docs:
    // { status: true, response: [{ id, name, olt_hardware_version, ip, telnet_port, snmp_port }] }
    const data = await this.realFetch('/api/system/get_olts', parseOltsResponse);
    return data.olts.map((o) => ({
      id: String(o['id']),
      name: String(o['name'] ?? ''),
      ip: String(o['ip'] ?? ''),
      status: 'online' as const,
      // Real SmartOLT doesn't return uptime/temp here; that's in the uptime
      // endpoint. The hardware version does come here.
      model:
        typeof o['olt_hardware_version'] === 'string' ? o['olt_hardware_version'] : undefined,
    }));
  }

  async getOltDetail(oltId: string): Promise<OltDetail> {
    if (this.useMock) {
      // Router-extracted identifiers may be normalized to uppercase. Resolve
      // against the canonical fixture ID without changing the returned ID or
      // the existing not-found contract.
      const normalizedOltId = oltId.trim().toLowerCase();
      const olt = FIXTURE_OLTS.find((o) => o.id.toLowerCase() === normalizedOltId);
      if (!olt) throw new Error(`OLT ${oltId} not found`);
      const onusConnected = FIXTURE_ONUS.filter(
        (o) => o.oltId === olt.id && o.status === 'online',
      ).length;

      // Build OltDetail from fixture data
      const oltDetail: OltDetail = {
        id: olt.id,
        name: olt.name,
        ip: olt.ip,
        status: olt.status as OltDetail['status'],
        uptimeSeconds: olt.uptimeSeconds,
        temperatureCelsius: olt.temperatureCelsius,
        model: olt.olt_hardware_version,
        vendorId: olt.vendor,
        ponPortsActive: this.countPonPorts(olt.id),
        ponPortsMax: this.estimatePonPortsMax(olt.olt_hardware_version),
        ponTechnology: this.estimatePonTechnology(olt.olt_hardware_version),
        maxSubscribers: this.estimateMaxSubscribers(olt.olt_hardware_version),
        subscribersConnected: onusConnected,
        formFactor: this.estimateFormFactor(olt.olt_hardware_version),
        firmwareVersion: olt.firmware,
      };
      return oltDetail;
    }

    // Real: la temperatura y el uptime viven en su propio endpoint; el nombre,
    // la IP y el modelo, en la lista de OLTs.
    const uptime = await this.realFetch(
      `/api/olt/get_olt_uptime_and_env_temperature/${encodeURIComponent(oltId)}`,
      parseOltUptimeResponse,
    );
    const olts = await this.listOlts();
    const identity = olts.find((olt) => olt.id === oltId);
    const onus = await this.listOnus({ oltId });
    const onlineOnus = onus.filter((o) => o.status === 'online').length;

    return {
      id: oltId,
      name: identity?.name ?? oltId,
      ip: identity?.ip ?? '',
      status: 'online' as const,
      uptimeSeconds: uptime.uptimeSeconds,
      temperatureCelsius: uptime.temperatureCelsius,
      ...(identity?.model === undefined ? {} : { model: identity.model }),
      subscribersConnected: onlineOnus,
    };
  }

  /** Estimate max PON ports based on OLT model */
  private estimatePonPortsMax(model: string): number {
    const upper = model.toUpperCase();
    if (upper.includes('MA5800') || upper.includes('C600') || upper.includes('FX-16')) return 256;
    if (upper.includes('MA5600') || upper.includes('C650') || upper.includes('FX-8')) return 128;
    if (upper.includes('C320') || upper.includes('FX-4')) return 64;
    return 32; // Default for unknown models
  }

  /** Estimate PON technology based on OLT model */
  private estimatePonTechnology(model: string): PonTechnology | undefined {
    const upper = model.toUpperCase();
    if (upper.includes('XGS') || upper.includes('10G')) return 'XGS-PON';
    if (upper.includes('XG')) return 'XG-PON';
    return 'GPON';
  }

  /** Estimate max subscribers based on OLT model */
  private estimateMaxSubscribers(model: string): number {
    const upper = model.toUpperCase();
    if (upper.includes('MA5800') || upper.includes('C600')) return 32000;
    if (upper.includes('MA5600') || upper.includes('C650')) return 16000;
    if (upper.includes('C320') || upper.includes('FX-4')) return 4000;
    return 8000;
  }

  /** Estimate form factor based on OLT model */
  private estimateFormFactor(model: string): OltFormFactor {
    const upper = model.toUpperCase();
    if (upper.includes('FX-16') || upper.includes('C600')) return 'chassis';
    if (upper.includes('FX-8') || upper.includes('C650')) return 'chassis';
    if (upper.includes('C320') || upper.includes('FX-4') || upper.includes('MA5608')) return '1U';
    return '2U';
  }

  /** Count active PON ports for an OLT (mock implementation) */
  private countPonPorts(oltId: string): number {
    // In real implementation, this would query the NMS
    const onuCount = FIXTURE_ONUS.filter((o) => o.oltId === oltId).length;
    // Estimate based on typical 1:64 split ratio
    return Math.ceil(onuCount / 64) || 1;
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
      oltsWithHighTemperature: 0, // would need to call the uptime endpoint for each
    };
  }

  async listOnus(
    filter?: { oltId?: string; status?: OnuSummary['status'] },
    options: SmartoltListOnusOptions = {},
  ): Promise<OnuSummary[]> {
    if (this.useMock) {
      let result = [...FIXTURE_ONUS];
      if (filter?.oltId) result = result.filter((o) => o.oltId === filter.oltId);
      if (filter?.status) result = result.filter((o) => o.status === filter.status);
      return result;
    }

    const rows = await this.fetchOnuRows({
      ...options,
      ...(filter?.oltId === undefined ? {} : { oltId: filter.oltId }),
    });
    let onus = rows.map((o) => this.mapOnuSummary(o));
    if (filter?.status) onus = onus.filter((o) => o.status === filter.status);
    return onus;
  }

  /**
   * Recorre el inventario de ONUs página por página.
   *
   * `page` es obligatorio en cada llamada: sin él, el endpoint es el export
   * completo (15/hora, bloqueo al llegar). Se corta cuando se cubrió
   * `total_items`, cuando la página vino incompleta o cuando se llegó al tope
   * de páginas (que falla, no trunca).
   */
  private async fetchOnuRows(
    options: SmartoltListOnusOptions & {
      oltId?: string;
      externalId?: string;
      sn?: string;
      name?: string;
    } = {},
  ): Promise<Array<Record<string, unknown>>> {
    const endpoint = '/api/onu/get_all_onus_details';
    const requestedPageSize = options.pageSize ?? ONUS_PAGE_SIZE;
    const pageSize = Math.min(
      ONUS_PAGE_SIZE,
      Math.max(1, Math.trunc(requestedPageSize)),
    );
    const maxPages = options.maxPages ?? this.maxPages;
    const rows: Array<Record<string, unknown>> = [];
    let totalItems: number | undefined;

    for (let page = 1; ; page++) {
      const query = new URLSearchParams({
        page: String(page),
        page_size: String(pageSize),
      });
      if (options.updatedSince !== undefined) query.set('updated_since', options.updatedSince);
      if (options.oltId !== undefined) query.set('olt_id', options.oltId);
      if (options.externalId !== undefined) query.set('external_id', options.externalId);
      if (options.sn !== undefined) query.set('sn', options.sn);
      if (options.name !== undefined) query.set('name', options.name);

      const parsed = await this.realFetch(`${endpoint}?${query.toString()}`, parseOnusPageResponse);
      totalItems ??= parsed.totalItems;
      rows.push(...parsed.onus);

      if (parsed.onus.length === 0) {
        // An empty page before total_items is covered would silently truncate
        // the inventory; fail instead so the caller never sees a partial list.
        if (totalItems !== undefined && rows.length < totalItems) {
          throw new SmartoltResponseShapeError(endpoint, [
            `page ${page} came back empty with ${rows.length} de ${totalItems} ONUs`,
          ]);
        }
        break;
      }
      if (totalItems === undefined) {
        if (parsed.onus.length < pageSize) break;
      } else if (rows.length >= totalItems) {
        break;
      }
      if (parsed.totalPages !== undefined && page >= parsed.totalPages) break;
      if (page >= maxPages) {
        throw new SmartoltPaginationLimitError(endpoint, page, maxPages, totalItems);
      }
    }

    return rows;
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

    // El identificador puede ser el id externo o el serial: se busca con el
    // filtro del endpoint (una página) en vez de bajar el inventario entero.
    const byExternalId = await this.fetchOnuRows({ externalId: identifier });
    const externalMatch = byExternalId.find(
      (o) => String(o['unique_external_id']) === identifier || String(o['sn']) === identifier,
    );
    if (externalMatch) return this.mapOnuDetail(externalMatch);

    const bySerial = await this.fetchOnuRows({ sn: identifier });
    const serialMatch = bySerial.find(
      (o) => String(o['sn']) === identifier || String(o['unique_external_id']) === identifier,
    );
    return serialMatch ? this.mapOnuDetail(serialMatch) : null;
  }

  async getOnusWithLowSignal(thresholdDbm: number): Promise<OnuSummary[]> {
    if (this.useMock) {
      return FIXTURE_ONUS.filter(
        (o) => (o.rxPowerDbm ?? 0) < thresholdDbm && o.rxPowerDbm !== undefined,
      );
    }
    // Real: filter the paginated inventory response
    const onus = await this.listOnus();
    return onus.filter((o) => (o.rxPowerDbm ?? 0) < thresholdDbm && o.rxPowerDbm !== undefined);
  }

  async searchByCustomerName(name: string): Promise<OnuSummary[]> {
    if (this.useMock) {
      const lower = name.toLowerCase();
      return FIXTURE_ONUS.filter(o => o.customerName?.toLowerCase().includes(lower));
    }
    // `name` es un filtro de texto parcial del propio endpoint de inventario.
    const rows = await this.fetchOnuRows({ name });
    return rows.map((o) => this.mapOnuSummary(o));
  }

  async listOnusByOlt(oltId: string): Promise<OnuDetail[]> {
    throw new Error(
      'listOnusByOlt is not supported by SmartOLT. Use listOnus({ oltId }) instead.',
    );
  }

  // ── Helpers for mapping real SmartOLT responses to INmsConnector types ──

  private mapOnuSummary(o: Record<string, unknown>): OnuSummary {
    const status = this.mapStatus(o['status'] as string | null | undefined);
    return {
      id: String(o['unique_external_id'] ?? o['sn'] ?? ''),
      serial: String(o['sn'] ?? ''),
      oltId: String(o['olt_id'] ?? ''),
      customerName: typeof o['name'] === 'string' ? o['name'] : undefined,
      status,
      rxPowerDbm: this.parseFloat(o['signal']),
      txPowerDbm: this.parseFloat(o['signal_1490']),
      uptimeSeconds: undefined,
      lastSeenAt: typeof o['last_status_change'] === 'string' ? o['last_status_change'] : undefined,
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
      // P2.2 / AD-3 — defensive 6-key pickNumber coverage so we stay
      // compatible with every SmartOLT API shape we have observed. Unresolved
      // (Mikrowisp / older firmware) leaves the field undefined → `pointIfFinite`
      // skips it on emission → empty series → null detector (REQ "Mikrowisp
      // graceful no-op").
      losSecondsTotal: pickNumber(o, [
        'los_seconds_total',
        'los_seconds',
        'losCount',
        'los_count',
        'loss_of_signal_seconds',
        'signal_loss_seconds',
      ]),
    };
  }

  private mapOnuDetail(o: Record<string, unknown>): OnuDetail {
    const summary = this.mapOnuSummary(o);
    const onuTypeName = typeof o['onu_type_name'] === 'string' ? o['onu_type_name'] : undefined;
    return {
      ...summary,
      model: onuTypeName?.split('-').pop(),
      vendor: onuTypeName?.split('-')[0],
      oltPort:
        o['board'] !== undefined && o['port'] !== undefined && o['onu'] !== undefined
          ? `${String(o['board'])}/${String(o['port'])}/${String(o['onu'])}`
          : undefined,
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

/** Lee el cuerpo JSON de una respuesta, o `undefined` si no es JSON. */
async function readJsonOrUndefined(res: Response): Promise<unknown> {
  try {
    return (await res.json()) as unknown;
  } catch {
    return undefined;
  }
}

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
