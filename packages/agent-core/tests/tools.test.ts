import { describe, expect, it, vi } from 'vitest';
import type { INmsConnector } from '@ftth-copilot/connectors-core';
import { buildDefaultConnector, buildTools, executeToolCall } from '../src/tools/index';

function connector(): INmsConnector {
  return {
    providerName: 'test',
    ping: vi.fn(async () => ({ ok: true })),
    listOlts: vi.fn(async () => [{ id: 'olt-1', name: 'OLT 1', ip: '1.1.1.1', status: 'online' }] as const),
    getOltDetail: vi.fn(async (id) => ({ id, name: 'OLT 1', ip: '1.1.1.1', status: 'online', onusConnected: 1 })),
    getNetworkOverview: vi.fn(async () => ({ totalOlts: 1, oltsOnline: 1, totalOnus: 1, onusOnline: 1, onusOffline: 0, averageUptimeSeconds: 1, oltsWithHighTemperature: 0 })),
    listOnus: vi.fn(async () => [{ id: 'onu-1', serial: 'sn-1', oltId: 'olt-1', status: 'online' }] as const),
    getOnuDetail: vi.fn(async (id) => id === 'missing' ? null : ({ id, serial: 'sn-1', oltId: 'olt-1', status: 'online' })),
    getOnusWithLowSignal: vi.fn(async () => []),
    searchByCustomerName: vi.fn(async () => []),
  };
}

describe('agent tools', () => {
  it('exposes only read-only tools', () => {
    const names = buildTools(connector()).map((tool) => tool.name);
    expect(names).toContain('get_network_overview');
    expect(names).not.toContain('reboot_ont');
  });

  it('builds the default connector explicitly from environment configuration', () => {
    process.env['SMARTOLT_USE_MOCK'] = 'true';
    expect(buildDefaultConnector().providerName).toBe('smartolt');
    delete process.env['SMARTOLT_USE_MOCK'];
  });

  it.each([
    ['list_olts', {}],
    ['get_olt_detail', { oltId: 'olt-1' }],
    ['get_network_overview', {}],
    ['list_onus', { status: 'online', oltId: 'olt-1' }],
    ['get_onu_detail', { identifier: 'onu-1' }],
    ['get_onus_with_low_signal', { thresholdDbm: -27 }],
    ['search_by_customer_name', { customerName: 'Ada' }],
  ])('executes %s', async (name, args) => {
    const result = await executeToolCall(connector(), name, args);
    expect(result).not.toContain('Tool desconocida');
  });

  it('serializes not-found and unknown-tool results safely', async () => {
    await expect(executeToolCall(connector(), 'get_onu_detail', { identifier: 'missing' }))
      .resolves.toMatch(/No encontrado/);
    await expect(executeToolCall(connector(), 'unknown', {}))
      .resolves.toMatch(/Tool desconocida/);
  });

  it('returns connector failures as tool errors', async () => {
    const failing = connector();
    failing.listOlts = vi.fn(async () => { throw new Error('offline'); });
    await expect(executeToolCall(failing, 'list_olts', {})).resolves.toContain('offline');
  });
});
