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

  it('characterizes the -27 dBm RX threshold boundary, offline exclusion, and exact alert text', async () => {
    const connector = {
      listOlts: vi.fn(async () => []),
      listOnus: vi.fn(async () => [
        { id: 'onu-above', serial: '1', oltId: 'olt-1', status: 'online', rxPowerDbm: -26.9, customerName: 'Encima' },
        { id: 'onu-exact', serial: '2', oltId: 'olt-1', status: 'online', rxPowerDbm: -27, customerName: 'Exacto' },
        { id: 'onu-below', serial: '3', oltId: 'olt-1', status: 'online', rxPowerDbm: -27.1, customerName: 'Debajo' },
        { id: 'onu-offline', serial: '4', oltId: 'olt-1', status: 'offline', rxPowerDbm: -30, customerName: 'Caida' },
      ]),
      getNetworkOverview: vi.fn(async () => ({ totalOlts: 0 })),
    } as unknown as INmsConnector;

    const alerts = await detectAlerts(connector);
    const lowSignal = alerts.filter((a) => a.category === 'low_signal');
    expect(lowSignal).toHaveLength(1);
    expect(lowSignal[0]).toMatchObject({
      id: 'alert-onu-signal-onu-below',
      severity: 'warning',
      category: 'low_signal',
      title: 'Señal baja: Debajo',
      description: 'ONU onu-below (Debajo) tiene RX power de -27.1 dBm (umbral: -27 dBm).',
      affectedEntity: 'onu-below',
    });

    const offline = alerts.filter((a) => a.category === 'offline');
    expect(offline).toHaveLength(1);
    expect(offline[0]?.affectedEntity).toBe('onu-offline');
  });
});
