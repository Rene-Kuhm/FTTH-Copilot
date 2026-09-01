import { describe, it, expect, vi } from 'vitest';
import type { INmsConnector, OltSummary, OnuSummary } from '@ftth-copilot/connectors-core';
import { collectSamples } from '../src/collect';

const META = { tenantId: 't1', connectionId: 'c1' };
const ISO = '2026-08-21T00:00:00.000Z';

function makeConnector(overrides: Partial<INmsConnector> = {}): INmsConnector {
  return {
    providerName: 'test',
    ping: vi.fn(async () => ({ ok: true })),
    listOlts: vi.fn(async () => []),
    getOltDetail: vi.fn(async () => {
      throw new Error('getOltDetail not stubbed');
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
    listOnus: vi.fn(async () => []),
    getOnuDetail: vi.fn(async () => null),
    getOnusWithLowSignal: vi.fn(async () => []),
    searchByCustomerName: vi.fn(async () => []),
    ...overrides,
  } as INmsConnector;
}

const OLT: OltSummary = {
  id: 'OLT-1',
  name: 'olt-1',
  ip: '10.0.0.1',
  status: 'online',
  temperatureCelsius: 55,
  uptimeSeconds: 1000,
};

const ONU: OnuSummary = {
  id: 'ONU-1',
  serial: 'SN-1',
  oltId: 'OLT-1',
  customerName: 'Cliente',
  status: 'online',
  rxPowerDbm: -22.5,
  txPowerDbm: 2.1,
  uptimeSeconds: 86400,
};

describe('collectSamples', () => {
  it('collects OLT status, temperature and uptime from the bulk list', async () => {
    const connector = makeConnector({
      listOlts: vi.fn(async () => [OLT]),
      listOnus: vi.fn(async () => []),
    });

    const points = await collectSamples(connector, META, { now: new Date(ISO) });

    expect(points).toEqual([
      { ...META, deviceKind: 'OLT', deviceId: 'OLT-1', kind: 'STATUS', valueText: 'online', sampledAt: ISO },
      { ...META, deviceKind: 'OLT', deviceId: 'OLT-1', kind: 'TEMPERATURE_CELSIUS', value: 55, sampledAt: ISO },
      { ...META, deviceKind: 'OLT', deviceId: 'OLT-1', kind: 'UPTIME_SECONDS', value: 1000, sampledAt: ISO },
    ]);
  });

  it('collects ONU rx, tx, uptime and status', async () => {
    const connector = makeConnector({
      listOlts: vi.fn(async () => []),
      listOnus: vi.fn(async () => [ONU]),
    });

    const points = await collectSamples(connector, META, { now: new Date(ISO) });

    expect(points).toEqual([
      { ...META, deviceKind: 'ONU', deviceId: 'ONU-1', kind: 'STATUS', valueText: 'online', sampledAt: ISO },
      { ...META, deviceKind: 'ONU', deviceId: 'ONU-1', kind: 'RX_POWER_DBM', value: -22.5, sampledAt: ISO },
      { ...META, deviceKind: 'ONU', deviceId: 'ONU-1', kind: 'TX_POWER_DBM', value: 2.1, sampledAt: ISO },
      { ...META, deviceKind: 'ONU', deviceId: 'ONU-1', kind: 'UPTIME_SECONDS', value: 86400, sampledAt: ISO },
    ]);
  });

  it('collects ONU FEC and optical-health metrics when present', async () => {
    const connector = makeConnector({
      listOlts: vi.fn(async () => []),
      listOnus: vi.fn(async () => [{
        ...ONU,
        fecCorrected: 42,
        fecUncorrected: 3,
        biasCurrentMa: 14.2,
        ontTemperatureCelsius: 58,
      }]),
    });

    const points = await collectSamples(connector, META, { now: new Date(ISO) });

    expect(points).toEqual(expect.arrayContaining([
      { ...META, deviceKind: 'ONU', deviceId: 'ONU-1', kind: 'FEC_CORRECTED', value: 42, sampledAt: ISO },
      { ...META, deviceKind: 'ONU', deviceId: 'ONU-1', kind: 'FEC_UNCORRECTED', value: 3, sampledAt: ISO },
      { ...META, deviceKind: 'ONU', deviceId: 'ONU-1', kind: 'BIAS_CURRENT_MA', value: 14.2, sampledAt: ISO },
      { ...META, deviceKind: 'ONU', deviceId: 'ONU-1', kind: 'ONT_TEMPERATURE_CELSIUS', value: 58, sampledAt: ISO },
    ]));
  });

  it('skips optional metrics that are undefined', async () => {
    const connector = makeConnector({
      listOlts: vi.fn(async () => [{ id: 'OLT-1', name: 'olt', ip: '10.0.0.1', status: 'offline' }]),
      listOnus: vi.fn(async () => [{
        id: 'ONU-1',
        serial: 'SN-1',
        oltId: 'OLT-1',
        status: 'degraded',
      }]),
    });

    const points = await collectSamples(connector, META, { now: new Date(ISO) });

    expect(points).toEqual([
      { ...META, deviceKind: 'OLT', deviceId: 'OLT-1', kind: 'STATUS', valueText: 'offline', sampledAt: ISO },
      { ...META, deviceKind: 'ONU', deviceId: 'ONU-1', kind: 'STATUS', valueText: 'degraded', sampledAt: ISO },
    ]);
  });

  it('returns an empty array for an empty connector', async () => {
    const connector = makeConnector();
    const points = await collectSamples(connector, META, { now: new Date(ISO) });
    expect(points).toEqual([]);
  });

  it('reads OLT temperature and uptime from getOltDetail when includeOltDetail is true', async () => {
    const connector = makeConnector({
      listOlts: vi.fn(async () => [{ id: 'OLT-1', name: 'olt', ip: '10.0.0.1', status: 'online' }]),
      listOnus: vi.fn(async () => []),
      getOltDetail: vi.fn(async () => ({
        id: 'OLT-1',
        name: 'olt',
        ip: '10.0.0.1',
        status: 'online',
        temperatureCelsius: 61,
        uptimeSeconds: 999,
        onusConnected: 10,
      })),
    });

    const points = await collectSamples(connector, META, { now: new Date(ISO), includeOltDetail: true });

    expect(points).toEqual([
      { ...META, deviceKind: 'OLT', deviceId: 'OLT-1', kind: 'STATUS', valueText: 'online', sampledAt: ISO },
      { ...META, deviceKind: 'OLT', deviceId: 'OLT-1', kind: 'TEMPERATURE_CELSIUS', value: 61, sampledAt: ISO },
      { ...META, deviceKind: 'OLT', deviceId: 'OLT-1', kind: 'UPTIME_SECONDS', value: 999, sampledAt: ISO },
    ]);
  });

  it('does not duplicate temperature/uptime when both bulk and detail provide them', async () => {
    const connector = makeConnector({
      listOlts: vi.fn(async () => [OLT]),
      listOnus: vi.fn(async () => []),
      getOltDetail: vi.fn(async () => ({
        ...OLT,
        temperatureCelsius: 61,
        uptimeSeconds: 999,
        onusConnected: 10,
      })),
    });

    const points = await collectSamples(connector, META, { now: new Date(ISO), includeOltDetail: true });

    const tempPoints = points.filter((p) => p.kind === 'TEMPERATURE_CELSIUS');
    const uptimePoints = points.filter((p) => p.kind === 'UPTIME_SECONDS');
    expect(tempPoints).toHaveLength(1);
    expect(tempPoints[0]?.value).toBe(61);
    expect(uptimePoints).toHaveLength(1);
    expect(uptimePoints[0]?.value).toBe(999);
  });

  it('survives a getOltDetail failure for one OLT and keeps the rest', async () => {
    const connector = makeConnector({
      listOlts: vi.fn(async () => [
        { id: 'OLT-1', name: 'olt-1', ip: '10.0.0.1', status: 'online' },
        { id: 'OLT-2', name: 'olt-2', ip: '10.0.0.2', status: 'online' },
      ]),
      listOnus: vi.fn(async () => []),
      getOltDetail: vi.fn(async (oltId: string) => {
        if (oltId === 'OLT-1') throw new Error('boom');
        return {
          id: 'OLT-2',
          name: 'olt-2',
          ip: '10.0.0.2',
          status: 'online',
          temperatureCelsius: 70,
          onusConnected: 5,
        };
      }),
    });

    const points = await collectSamples(connector, META, { now: new Date(ISO), includeOltDetail: true });

    // Both OLTs keep their STATUS; only OLT-2 contributes temperature.
    const statuses = points.filter((p) => p.kind === 'STATUS');
    const temps = points.filter((p) => p.kind === 'TEMPERATURE_CELSIUS');
    expect(statuses.map((p) => p.deviceId)).toEqual(['OLT-1', 'OLT-2']);
    expect(temps).toHaveLength(1);
    expect(temps[0]?.deviceId).toBe('OLT-2');
    expect(temps[0]?.value).toBe(70);
  });

  it('uses the provided now as the sample timestamp for every point', async () => {
    const connector = makeConnector({
      listOlts: vi.fn(async () => [OLT]),
      listOnus: vi.fn(async () => [ONU]),
    });

    const now = new Date(ISO);
    const points = await collectSamples(connector, META, { now });

    expect(points.length).toBeGreaterThan(0);
    for (const p of points) {
      expect(p.sampledAt).toBe(ISO);
    }
  });

  it('fans out to getOnuDetail when includeOnuDetail is true, overlaying FEC/óptica', async () => {
    const detail = {
      ...ONU,
      fecCorrected: 1500,
      fecUncorrected: 4,
      biasCurrentMa: 36.1,
      ontTemperatureCelsius: 69,
    };
    const connector = makeConnector({
      listOlts: vi.fn(async () => []),
      listOnus: vi.fn(async () => [ONU]),
      getOnuDetail: vi.fn(async () => detail),
    });

    const points = await collectSamples(connector, META, {
      now: new Date(ISO),
      includeOnuDetail: true,
    });

    expect(points).toEqual(expect.arrayContaining([
      { ...META, deviceKind: 'ONU', deviceId: 'ONU-1', kind: 'FEC_CORRECTED', value: 1500, sampledAt: ISO },
      { ...META, deviceKind: 'ONU', deviceId: 'ONU-1', kind: 'FEC_UNCORRECTED', value: 4, sampledAt: ISO },
      { ...META, deviceKind: 'ONU', deviceId: 'ONU-1', kind: 'BIAS_CURRENT_MA', value: 36.1, sampledAt: ISO },
      { ...META, deviceKind: 'ONU', deviceId: 'ONU-1', kind: 'ONT_TEMPERATURE_CELSIUS', value: 69, sampledAt: ISO },
    ]));
    expect(connector.getOnuDetail).toHaveBeenCalled();
  });

  it('does not fan out to getOnuDetail by default', async () => {
    const connector = makeConnector({
      listOlts: vi.fn(async () => []),
      listOnus: vi.fn(async () => [ONU]),
      getOnuDetail: vi.fn(async () => ({
        ...ONU,
        fecCorrected: 1,
      })),
    });

    await collectSamples(connector, META, { now: new Date(ISO) });

    expect(connector.getOnuDetail).not.toHaveBeenCalled();
  });

  it('survives a getOnuDetail failure and still emits the summary points', async () => {
    const connector = makeConnector({
      listOlts: vi.fn(async () => []),
      listOnus: vi.fn(async () => [ONU]),
      getOnuDetail: vi.fn(async () => {
        throw new Error('boom');
      }),
    });

    const points = await collectSamples(connector, META, {
      now: new Date(ISO),
      includeOnuDetail: true,
    });

    // Status + rx + tx + uptime from the summary survive the detail failure.
    expect(points).toEqual(expect.arrayContaining([
      { ...META, deviceKind: 'ONU', deviceId: 'ONU-1', kind: 'STATUS', valueText: 'online', sampledAt: ISO },
      { ...META, deviceKind: 'ONU', deviceId: 'ONU-1', kind: 'RX_POWER_DBM', value: -22.5, sampledAt: ISO },
    ]));
    expect(points.find((p) => p.kind === 'FEC_CORRECTED')).toBeUndefined();
  });

  it('falls back to a serial lookup when the id lookup returns null', async () => {
    const onu = { ...ONU, serial: 'SN-Z' };
    const connector = makeConnector({
      listOlts: vi.fn(async () => []),
      listOnus: vi.fn(async () => [onu]),
      getOnuDetail: vi.fn(async (idOrSerial: string) => {
        if (idOrSerial === 'ONU-1') return null;
        return { ...onu, fecCorrected: 77 };
      }),
    });

    const points = await collectSamples(connector, META, {
      now: new Date(ISO),
      includeOnuDetail: true,
    });

    expect(points.find((p) => p.kind === 'FEC_CORRECTED')).toEqual({
      ...META, deviceKind: 'ONU', deviceId: 'ONU-1', kind: 'FEC_CORRECTED', value: 77, sampledAt: ISO,
    });
  });
});
