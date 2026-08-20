/**
 * Unit tests for SmartOltClient in mock mode.
 * Verifies that the mock fixtures are coherent and that the INmsConnector
 * surface area (listOlts, getNetworkOverview, listOnus, etc.) works.
 */
import { describe, it, expect } from 'vitest';
import { SmartOltClient } from '../src/client';

describe('SmartOltClient (mock mode)', () => {
  const client = new SmartOltClient({ useMock: true });

  it('ping returns ok with a latency', async () => {
    const result = await client.ping();
    expect(result.ok).toBe(true);
    expect(result.latencyMs).toBeGreaterThan(0);
  });

  it('listOlts returns the 3 fixture OLTs', async () => {
    const olts = await client.listOlts();
    expect(olts).toHaveLength(3);
    const ids = olts.map((o) => o.id);
    expect(ids).toContain('OLT-001');
    expect(ids).toContain('OLT-002');
    expect(ids).toContain('OLT-003');
  });

  it('OLT-003 is degraded (high temperature)', async () => {
    const olts = await client.listOlts();
    const olt003 = olts.find((o) => o.id === 'OLT-003');
    expect(olt003?.status).toBe('degraded');
    expect(olt003?.temperatureCelsius).toBeGreaterThan(60);
  });

  it('getNetworkOverview reports at least one offline ONU', async () => {
    const overview = await client.getNetworkOverview();
    expect(overview.totalOlts).toBe(3);
    expect(overview.onusOffline).toBeGreaterThan(0);
    expect(overview.oltsWithHighTemperature).toBe(1);
  });

  it('listOnus can be filtered by oltId and status', async () => {
    const offlineOnus = await client.listOnus({ status: 'offline' });
    expect(offlineOnus.length).toBeGreaterThan(0);
    expect(offlineOnus.every((o) => o.status === 'offline')).toBe(true);

    const olt003 = await client.listOnus({ oltId: 'OLT-003' });
    expect(olt003.length).toBeGreaterThan(0);
    expect(olt003.every((o) => o.oltId === 'OLT-003')).toBe(true);
  });

  it('getOnuDetail works by id and by serial number', async () => {
    const byId = await client.getOnuDetail('ONU-0001');
    expect(byId).not.toBeNull();
    expect(byId?.serial).toBe('SN-A1B2C3D4');

    const bySerial = await client.getOnuDetail('SN-A1B2C3D4');
    expect(bySerial?.id).toBe('ONU-0001');
  });

  it('getOnuDetail returns null for unknown identifier', async () => {
    const result = await client.getOnuDetail('NONEXISTENT');
    expect(result).toBeNull();
  });

  it('getOnusWithLowSignal(-27) flags the degraded ONUs', async () => {
    const low = await client.getOnusWithLowSignal(-27);
    expect(low.length).toBeGreaterThan(0);
    expect(low.every((o) => (o.rxPowerDbm ?? 0) < -27)).toBe(true);
  });

  it('getOltDetail returns the OLT with onusConnected count', async () => {
    const detail = await client.getOltDetail('OLT-001');
    expect(detail.id).toBe('OLT-001');
    expect(detail.onusConnected).toBeGreaterThan(0);
  });
});
