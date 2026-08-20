/**
 * INmsConnector — interfaz común para adapters de NMS.
 *
 * Cada NMS (SmartOLT, NetSense, Mikrowisp) implementa esta interfaz.
 * El agente solo conoce esta interfaz, no el NMS específico.
 */

export interface OltSummary {
  id: string;
  name: string;
  ip: string;
  status: 'online' | 'offline' | 'degraded';
  uptimeSeconds?: number;
  temperatureCelsius?: number;
}

export interface OnuSummary {
  id: string;
  serial: string;
  oltId: string;
  customerName?: string;
  status: 'online' | 'offline' | 'degraded';
  rxPowerDbm?: number;
  txPowerDbm?: number;
  uptimeSeconds?: number;
  lastSeenAt?: string;
}

export interface OnuDetail extends OnuSummary {
  model?: string;
  vendor?: string;
  oltPort?: string;
  firmwareVersion?: string;
  signalHistory?: Array<{
    timestamp: string;
    rxPowerDbm: number;
  }>;
}

export interface NetworkOverview {
  totalOlts: number;
  oltsOnline: number;
  totalOnus: number;
  onusOnline: number;
  onusOffline: number;
  averageUptimeSeconds: number;
  oltsWithHighTemperature: number;
}

export interface RateLimitError extends Error {
  code: 'RATE_LIMIT';
  retryAfterSeconds?: number;
}

export interface INmsConnector {
  readonly providerName: string;

  /** Ping al NMS para validar credenciales. */
  ping(): Promise<{ ok: boolean; latencyMs?: number; error?: string }>;

  /** Lista de todos los OLTs. */
  listOlts(): Promise<OltSummary[]>;

  /** Detalle de un OLT específico (incluye uptime y temperatura). */
  getOltDetail(oltId: string): Promise<OltSummary & { onusConnected: number }>;

  /** Resumen de la red entera. */
  getNetworkOverview(): Promise<NetworkOverview>;

  /** Lista de ONUs, opcionalmente filtradas por OLT. */
  listOnus(filter?: { oltId?: string; status?: OnuSummary['status'] }): Promise<OnuSummary[]>;

  /** Detalle completo de una ONU por serial o por id. */
  getOnuDetail(identifier: string): Promise<OnuDetail | null>;

  /** ONUs con señal RX por debajo del umbral (en dBm). */
  getOnusWithLowSignal(thresholdDbm: number): Promise<OnuSummary[]>;
}

export function isRateLimitError(err: unknown): err is RateLimitError {
  return err instanceof Error && 'code' in err && (err as { code: unknown }).code === 'RATE_LIMIT';
}
