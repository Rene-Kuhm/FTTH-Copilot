import { describe, it, expect } from 'vitest';
import { MikrotikNmsAdapter, parseMikrotikUptimeSeconds } from '../src/adapter';

describe('parseMikrotikUptimeSeconds', () => {
  it('parses standard letter-based uptimes', () => {
    expect(parseMikrotikUptimeSeconds('1w2d3h4m5s')).toBe(1 * 7 * 86400 + 2 * 86400 + 3 * 3600 + 4 * 60 + 5);
    expect(parseMikrotikUptimeSeconds('15m30s')).toBe(15 * 60 + 30);
    expect(parseMikrotikUptimeSeconds('4h')).toBe(4 * 3600);
  });

  it('parses colon-based uptimes', () => {
    expect(parseMikrotikUptimeSeconds('04:12:30')).toBe(4 * 3600 + 12 * 60 + 30);
    expect(parseMikrotikUptimeSeconds('2d05:10:00')).toBe(2 * 86400 + 5 * 3600 + 10 * 60);
  });

  it('handles empty or undefined strings gracefully', () => {
    expect(parseMikrotikUptimeSeconds('')).toBe(0);
    expect(parseMikrotikUptimeSeconds(undefined)).toBe(0);
  });
});

describe('MikrotikNmsAdapter (Mock/Fixtures)', () => {
  const adapter = new MikrotikNmsAdapter({
    useMock: true,
    host: '192.168.88.1',
  });

  it('pings the mock router successfully', async () => {
    const res = await adapter.ping();
    expect(res.ok).toBe(true);
    expect(res.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('lists OLTs derived from system resource', async () => {
    const olts = await adapter.listOlts();
    expect(olts).toHaveLength(1);
    expect(olts[0].name).toContain('MikroTik');
    expect(olts[0].ip).toBe('192.168.88.1');
    expect(olts[0].status).toBe('online');
  });

  it('returns OLT detail with connected interfaces count', async () => {
    const detail = await adapter.getOltDetail('mt-main');
    expect(detail.id).toBeDefined();
    expect(detail.onusConnected).toBeGreaterThanOrEqual(0);
  });

  it('computes network overview from resources and interfaces', async () => {
    const overview = await adapter.getNetworkOverview();
    expect(overview.totalOlts).toBe(1);
    expect(overview.oltsOnline).toBe(1);
    expect(overview.totalOnus).toBeGreaterThan(0);
  });

  it('lists ONUs / interfaces with status mapping', async () => {
    const onus = await adapter.listOnus();
    expect(onus.length).toBeGreaterThan(0);
    const onlineOnus = await adapter.listOnus({ status: 'online' });
    expect(onlineOnus.every((o) => o.status === 'online')).toBe(true);
  });

  it('retrieves ONU detail including SFP optical metrics when available', async () => {
    const detail = await adapter.getOnuDetail('sfp-sfpplus1');
    expect(detail).not.toBeNull();
    if (detail) {
      expect(detail.id).toBe('sfp-sfpplus1');
      expect(detail.rxPowerDbm).toBeDefined();
      expect(detail.txPowerDbm).toBeDefined();
    }
  });

  it('returns null for non-existent interface/ONU', async () => {
    const detail = await adapter.getOnuDetail('non-existent-port');
    expect(detail).toBeNull();
  });

  it('filters ONUs with low optical signal', async () => {
    const lowSignal = await adapter.getOnusWithLowSignal(-10);
    expect(Array.isArray(lowSignal)).toBe(true);
  });

  it('searches by customer name in comments or PPPoE sessions', async () => {
    const res = await adapter.searchByCustomerName('uplink');
    expect(Array.isArray(res)).toBe(true);
  });
});
