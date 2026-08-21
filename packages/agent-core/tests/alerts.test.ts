import { describe, expect, it, vi } from 'vitest';
import type { INmsConnector } from '@ftth-copilot/connectors-core';
import { detectAlerts } from '../src/alerts';

describe('detectAlerts', () => {
  it('detects and orders critical, degraded, temperature and signal alerts', async () => {
    const connector = {
      providerName: 'test',
      listOlts: vi.fn(async () => [
        { id: 'hot', name: 'Hot OLT', ip: '1.1.1.1', status: 'online', temperatureCelsius: 72 },
        { id: 'degraded', name: 'Degraded OLT', ip: '1.1.1.2', status: 'degraded' },
      ]),
      listOnus: vi.fn(async () => [
        { id: 'off', serial: '1', oltId: 'hot', status: 'offline' },
        { id: 'weak', serial: '2', oltId: 'hot', status: 'online', rxPowerDbm: -29 },
        { id: 'bad', serial: '3', oltId: 'hot', status: 'degraded', rxPowerDbm: -26 },
      ]),
      getNetworkOverview: vi.fn(async () => ({ totalOlts: 2, oltsOnline: 1, totalOnus: 3, onusOnline: 1, onusOffline: 1, averageUptimeSeconds: 1, oltsWithHighTemperature: 1 })),
    } as unknown as INmsConnector;

    const alerts = await detectAlerts(connector);
    expect(alerts.some((alert) => alert.category === 'high_temp')).toBe(true);
    expect(alerts.some((alert) => alert.category === 'low_signal')).toBe(true);
    expect(alerts[0]?.severity).toBe('critical');
  });

  it('returns an empty list for a healthy network', async () => {
    const connector = {
      listOlts: vi.fn(async () => []),
      listOnus: vi.fn(async () => []),
      getNetworkOverview: vi.fn(async () => ({ totalOlts: 0 })),
    } as unknown as INmsConnector;
    await expect(detectAlerts(connector)).resolves.toEqual([]);
  });
});
