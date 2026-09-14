import type {
  INmsConnector,
  OltSummary,
  OnuSummary,
  OnuDetail,
  NetworkOverview,
} from '@ftth-copilot/connectors-core';
import { MikrotikClient, type MikrotikClientOptions } from './client';

/**
 * Parses RouterOS uptime strings (e.g., '1w2d3h4m5s', '3d04:12:30', '04:12:30', '15m40s') into total seconds.
 */
export function parseMikrotikUptimeSeconds(uptimeStr: string | undefined): number {
  if (!uptimeStr) return 0;

  const str = uptimeStr.trim();
  let total = 0;

  // Pattern with colons: e.g. '04:12:30' or '2d05:10:00' or '1w2d04:12:30'
  if (str.includes(':')) {
    const colonIdx = str.indexOf(':');
    const prefix = str.slice(0, colonIdx);
    const suffix = str.slice(colonIdx + 1);

    const wMatch = prefix.match(/(\d+)w/i);
    const dMatch = prefix.match(/(\d+)d/i);
    if (wMatch) total += parseInt(wMatch[1], 10) * 7 * 86400;
    if (dMatch) total += parseInt(dMatch[1], 10) * 86400;

    const hourMatch = prefix.match(/(\d+)h/i);
    let hours = 0;
    if (hourMatch) {
      hours = parseInt(hourMatch[1], 10);
    } else {
      // Numbers directly preceding colon: e.g. '2d05' -> 5, or '04' -> 4
      const numMatch = prefix.match(/(\d+)$/);
      if (numMatch) hours = parseInt(numMatch[1], 10);
    }

    const rest = suffix.split(':');
    const mins = rest[0] ? parseInt(rest[0], 10) : 0;
    const secs = rest[1] ? parseInt(rest[1], 10) : 0;

    return total + (hours * 3600) + (mins * 60) + secs;
  }

  // Pure letter format: e.g. '1w2d3h4m5s'
  const weekMatch = str.match(/(\d+)w/i);
  const dayMatch = str.match(/(\d+)d/i);
  const hourMatch = str.match(/(\d+)h/i);
  const minMatch = str.match(/(\d+)m(?!s)/i);
  const secMatch = str.match(/(\d+)s/i);

  if (weekMatch) total += parseInt(weekMatch[1], 10) * 7 * 86400;
  if (dayMatch) total += parseInt(dayMatch[1], 10) * 86400;
  if (hourMatch) total += parseInt(hourMatch[1], 10) * 3600;
  if (minMatch) total += parseInt(minMatch[1], 10) * 60;
  if (secMatch) total += parseInt(secMatch[1], 10);

  return total;
}

export class MikrotikNmsAdapter implements INmsConnector {
  readonly providerName = 'mikrotik';
  private readonly client: MikrotikClient;
  private readonly host: string;

  constructor(opts: MikrotikClientOptions) {
    this.client = new MikrotikClient(opts);
    this.host = opts.host ?? '127.0.0.1';
  }

  async ping(): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
    return this.client.ping();
  }

  async listOlts(): Promise<OltSummary[]> {
    const resource = await this.client.getSystemResource();
    const id = resource.boardName ? `mt-${resource.boardName.toLowerCase().replace(/[^a-z0-9]/g, '-')}` : 'mt-main';
    const name = resource.boardName
      ? `MikroTik ${resource.boardName} (${resource.version})`
      : `MikroTik RouterOS (${resource.version})`;

    return [
      {
        id,
        name,
        ip: this.host,
        status: 'online',
        uptimeSeconds: parseMikrotikUptimeSeconds(resource.uptime),
        temperatureCelsius: resource.temperatureCelsius,
      },
    ];
  }

  async getOltDetail(oltId: string): Promise<OltSummary & { onusConnected: number }> {
    const olts = await this.listOlts();
    const olt = olts[0] ?? {
      id: oltId,
      name: `MikroTik RouterOS (${oltId})`,
      ip: this.host,
      status: 'online' as const,
      uptimeSeconds: 0,
    };

    const interfaces = await this.client.listInterfaces();
    const sfpInterfaces = interfaces.filter((i) => i.name.toLowerCase().includes('sfp') || i.type === 'ether');

    return {
      ...olt,
      onusConnected: sfpInterfaces.filter((i) => i.running).length,
    };
  }

  async getNetworkOverview(): Promise<NetworkOverview> {
    const resource = await this.client.getSystemResource();
    const interfaces = await this.client.listInterfaces();
    const running = interfaces.filter((i) => i.running).length;
    const offline = interfaces.filter((i) => !i.running && !i.disabled).length;

    return {
      totalOlts: 1,
      oltsOnline: 1,
      totalOnus: interfaces.length,
      onusOnline: running,
      onusOffline: offline,
      averageUptimeSeconds: parseMikrotikUptimeSeconds(resource.uptime),
      oltsWithHighTemperature: resource.temperatureCelsius && resource.temperatureCelsius > 60 ? 1 : 0,
    };
  }

  async listOnus(filter?: { oltId?: string; status?: OnuSummary['status'] }): Promise<OnuSummary[]> {
    const interfaces = await this.client.listInterfaces();
    const pppoeSessions = await this.client.listPppoeSessions().catch(() => []);
    const pppoeMap = new Map(pppoeSessions.map((p) => [p.name, p]));

    const summaries: OnuSummary[] = [];

    for (const iface of interfaces) {
      const status: OnuSummary['status'] = iface.running ? 'online' : iface.disabled ? 'degraded' : 'offline';
      if (filter?.status && status !== filter.status) {
        continue;
      }

      const pppoe = pppoeMap.get(iface.name);
      summaries.push({
        id: iface.name,
        serial: iface.macAddress ?? iface.name,
        oltId: 'mt-main',
        customerName: iface.comment ?? pppoe?.callerId ?? pppoe?.name,
        status,
        lastSeenAt: new Date().toISOString(),
      });
    }

    return summaries;
  }

  async getOnuDetail(identifier: string): Promise<OnuDetail | null> {
    const interfaces = await this.client.listInterfaces();
    const iface = interfaces.find(
      (i) => i.name === identifier || i.macAddress?.toLowerCase() === identifier.toLowerCase(),
    );

    if (!iface) {
      return null;
    }

    const sfp = await this.client.getSfpOpticalMetrics(iface.name).catch(() => null);

    return {
      id: iface.name,
      serial: iface.macAddress ?? iface.name,
      oltId: 'mt-main',
      customerName: iface.comment,
      status: iface.running ? 'online' : 'offline',
      vendor: sfp?.vendorName,
      model: sfp?.vendorPartNumber,
      oltPort: iface.name,
      rxPowerDbm: sfp?.sfpRxPowerDbm,
      txPowerDbm: sfp?.sfpTxPowerDbm,
      ontTemperatureCelsius: sfp?.sfpTemperatureCelsius,
      biasCurrentMa: sfp?.sfpCurrentMa,
      lastSeenAt: new Date().toISOString(),
    };
  }

  async getOnusWithLowSignal(thresholdDbm: number): Promise<OnuSummary[]> {
    const interfaces = await this.client.listInterfaces({ runningOnly: true });
    const sfpList = interfaces.filter((i) => i.name.toLowerCase().includes('sfp'));
    const results: OnuSummary[] = [];

    for (const iface of sfpList) {
      const metrics = await this.client.getSfpOpticalMetrics(iface.name).catch(() => null);
      if (metrics?.sfpRxPowerDbm !== undefined && metrics.sfpRxPowerDbm < thresholdDbm) {
        results.push({
          id: iface.name,
          serial: iface.macAddress ?? iface.name,
          oltId: 'mt-main',
          customerName: iface.comment,
          status: 'online',
          rxPowerDbm: metrics.sfpRxPowerDbm,
          txPowerDbm: metrics.sfpTxPowerDbm,
          ontTemperatureCelsius: metrics.sfpTemperatureCelsius,
          biasCurrentMa: metrics.sfpCurrentMa,
          lastSeenAt: new Date().toISOString(),
        });
      }
    }

    return results;
  }

  async searchByCustomerName(name: string): Promise<OnuSummary[]> {
    const q = name.toLowerCase();
    const interfaces = await this.client.listInterfaces();
    const pppoeSessions = await this.client.listPppoeSessions().catch(() => []);

    const matching: OnuSummary[] = [];

    for (const iface of interfaces) {
      if (iface.comment && iface.comment.toLowerCase().includes(q)) {
        matching.push({
          id: iface.name,
          serial: iface.macAddress ?? iface.name,
          oltId: 'mt-main',
          customerName: iface.comment,
          status: iface.running ? 'online' : 'offline',
          lastSeenAt: new Date().toISOString(),
        });
      }
    }

    for (const session of pppoeSessions) {
      if (session.name.toLowerCase().includes(q) || session.callerId?.toLowerCase().includes(q)) {
        if (!matching.some((m) => m.id === session.name)) {
          matching.push({
            id: session.name,
            serial: session.callerId || session.name,
            oltId: 'mt-main',
            customerName: session.name,
            status: 'online',
            lastSeenAt: new Date().toISOString(),
          });
        }
      }
    }

    return matching;
  }
}
