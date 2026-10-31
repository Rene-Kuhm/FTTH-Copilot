import { vi } from 'vitest';
import type { INmsConnector, OnuDetail, OnuSummary } from '@ftth-copilot/connectors-core';

/**
 * Fixtures of the FEC collection tests.
 *
 * The connector surface used by the FEC scheduler is only `listOnus` +
 * `getOnuDetail`; the remaining `INmsConnector` members are stubbed to keep
 * the type-checker happy without enabling real network calls.
 */

export interface FixtureConnector {
  listOnus: ReturnType<typeof vi.fn>;
  getOnuDetail: ReturnType<typeof vi.fn>;
}

export function makeOnu(id: string): OnuSummary {
  return { id, serial: `SN-${id}`, oltId: 'OLT-1', status: 'online' };
}

export function makeSmartOltDetail(id: string): OnuDetail {
  return {
    ...makeOnu(id),
    fecCorrected: 12,
    fecUncorrected: 3,
    biasCurrentMa: 18,
    ontTemperatureCelsius: 42,
    // SmartOLT details expose LOS as a monotonic seconds-since-boot counter;
    // the fixture follows the same "online, no degradation yet" baseline used
    // by the FEC fields. The 5-field fixture forces the happy-path assertion
    // to land at 8 ONUs × 5 kinds = 40 rows.
    losSecondsTotal: 30,
  };
}

export function makeMikrowispDetail(id: string): OnuDetail {
  // No fec* / biasCurrent* / ontTemperature* fields — Mikrowisp graceful no-op.
  return { ...makeOnu(id), model: 'HW-1G', vendor: 'Mikrotik' };
}

export function makeFixtureConnector(
  overrides: Partial<FixtureConnector> = {},
): INmsConnector {
  const connector: FixtureConnector = {
    listOnus: overrides.listOnus ?? vi.fn(),
    getOnuDetail: overrides.getOnuDetail ?? vi.fn(),
  };
  return {
    providerName: 'fixture',
    ping: vi.fn(async () => ({ ok: true })),
    listOlts: vi.fn(async () => []),
    getOltDetail: vi.fn(async () => {
      throw new Error('not used in fec scheduler tests');
    }),
    getNetworkOverview: vi.fn(async () => ({
      totalOlts: 0,
      oltsOnline: 0,
      totalOnus: 0,
      onusOnline: 0,
      onusOffline: 0,
      averageUptimeSeconds: 0,
      oltsWithHighTemperature: 0,
    })),
    listOnus: connector.listOnus,
    getOnuDetail: connector.getOnuDetail,
    getOnusWithLowSignal: vi.fn(async () => []),
    searchByCustomerName: vi.fn(async () => []),
  } as unknown as INmsConnector;
}

export const CONNECTION_FIXTURE = {
  id: 'conn-1',
  tenantId: 'tenant-1',
  provider: 'SMARTOLT' as const,
  label: 'SmartOLT prod',
  encryptedKey: 'encrypted-secret',
  baseUrl: 'https://smartolt.example.com/api',
};
