import type {
  INmsConnector,
  OltSummary,
  OnuSummary,
  OnuDetail,
  NetworkOverview,
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

/**
 * SmartOltClient — adapter de SmartOLT.
 *
 * Por defecto usa fixtures (modo mock). Cuando tengamos acceso a la API real,
 * cambiamos `useMock: false` y completamos apiKey/apiBaseUrl.
 */
export class SmartOltClient implements INmsConnector {
  readonly providerName = 'smartolt';

  constructor(private readonly opts: SmartOltClientOptions) {}

  async ping(): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
    if (this.opts.useMock) {
      return { ok: true, latencyMs: 12 };
    }
    // TODO: implementar contra API real cuando llegue sandbox
    return { ok: false, error: 'Real SmartOLT API not yet wired' };
  }

  async listOlts(): Promise<OltSummary[]> {
    if (this.opts.useMock) {
      return [...FIXTURE_OLTS];
    }
    // TODO: get_olts contra API real
    throw new Error('Real SmartOLT API not yet wired');
  }

  async getOltDetail(
    oltId: string,
  ): Promise<OltSummary & { onusConnected: number }> {
    if (this.opts.useMock) {
      const olt = FIXTURE_OLTS.find((o) => o.id === oltId);
      if (!olt) throw new Error(`OLT ${oltId} not found`);
      const onusConnected = FIXTURE_ONUS.filter(
        (o) => o.oltId === oltId && o.status === 'online',
      ).length;
      return { ...olt, onusConnected };
    }
    // TODO: get_olts_uptime_and_env_temperature
    throw new Error('Real SmartOLT API not yet wired');
  }

  async getNetworkOverview(): Promise<NetworkOverview> {
    if (this.opts.useMock) {
      return computeOverview();
    }
    // TODO: derivado de listOlts + listOnus
    throw new Error('Real SmartOLT API not yet wired');
  }

  async listOnus(filter?: {
    oltId?: string;
    status?: OnuSummary['status'];
  }): Promise<OnuSummary[]> {
    if (this.opts.useMock) {
      let result = [...FIXTURE_ONUS];
      if (filter?.oltId) result = result.filter((o) => o.oltId === filter.oltId);
      if (filter?.status) result = result.filter((o) => o.status === filter.status);
      return result;
    }
    // TODO: get_all_onus_details
    throw new Error('Real SmartOLT API not yet wired');
  }

  async getOnuDetail(identifier: string): Promise<OnuDetail | null> {
    if (this.opts.useMock) {
      // Buscar por id directo, luego por serial
      const direct = FIXTURE_ONU_DETAILS[identifier];
      if (direct) return direct;
      const bySerial = Object.values(FIXTURE_ONU_DETAILS).find(
        (o) => o.serial === identifier,
      );
      if (bySerial) return bySerial;
      // Fallback: devolver resumen sin histórico
      const summary = FIXTURE_ONUS.find(
        (o) => o.id === identifier || o.serial === identifier,
      );
      return summary ?? null;
    }
    // TODO: combinación de endpoints
    throw new Error('Real SmartOLT API not yet wired');
  }

  async getOnusWithLowSignal(thresholdDbm: number): Promise<OnuSummary[]> {
    if (this.opts.useMock) {
      return FIXTURE_ONUS.filter(
        (o) => (o.rxPowerDbm ?? 0) < thresholdDbm && o.rxPowerDbm !== undefined,
      );
    }
    // TODO: derivado de listOnus
    throw new Error('Real SmartOLT API not yet wired');
  }
}
