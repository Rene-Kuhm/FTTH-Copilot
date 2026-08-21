/**
 * Unit tests for MikrowispClient in mock mode.
 * Verifies that the mock fixtures are coherent and that the INmsConnector
 * surface area (listOlts, getNetworkOverview, listOnus, etc.) works,
 * plus Mikrowisp-specific methods (listClients, getOdbList).
 */
import { describe, it, expect } from 'vitest';
import { MikrowispClient } from '../src/client';

describe('MikrowispClient (mock mode)', () => {
  const client = new MikrowispClient({ useMock: true });

  it('ping returns ok with a latency', async () => {
    const result = await client.ping();
    expect(result.ok).toBe(true);
    expect(result.latencyMs).toBeGreaterThan(0);
  });

  it('listOlts returns 4 fixture routers as OLTs', async () => {
    const olts = await client.listOlts();
    expect(olts).toHaveLength(4);
    const ids = olts.map((o) => o.id);
    expect(ids).toContain('RT-BSAS-01');
    expect(ids).toContain('RT-CBA-01');
    expect(ids).toContain('RT-MZA-01');
    expect(ids).toContain('RT-BSAS-02');
  });

  it('listOlts maps router estado to OltSummary status', async () => {
    const olts = await client.listOlts();
    const bsas01 = olts.find((o) => o.id === 'RT-BSAS-01');
    expect(bsas01?.status).toBe('online');
    const bsas02 = olts.find((o) => o.id === 'RT-BSAS-02');
    expect(bsas02?.status).toBe('offline');
  });

  it('getOltDetail returns the OLT with onusConnected count', async () => {
    const detail = await client.getOltDetail('RT-BSAS-01');
    expect(detail.id).toBe('RT-BSAS-01');
    expect(detail.name).toBe('MikroTik-RB3011-Centro');
    expect(detail.onusConnected).toBeGreaterThanOrEqual(1);
  });

  it('getOltDetail throws for unknown router', async () => {
    await expect(client.getOltDetail('RT-UNKNOWN')).rejects.toThrow('Router/OLT RT-UNKNOWN not found');
  });

  it('getNetworkOverview aggregates routers+equipment and ONUs', async () => {
    const overview = await client.getNetworkOverview();
    expect(overview.totalOlts).toBe(12);
    expect(overview.totalOnus).toBeGreaterThan(0);
    expect(overview.onusOffline).toBeGreaterThan(0);
    expect(overview.oltsWithHighTemperature).toBeGreaterThan(0);
  });

  it('listOnus can be filtered by status', async () => {
    const offlineOnus = await client.listOnus({ status: 'offline' });
    expect(offlineOnus.length).toBeGreaterThan(0);
    expect(offlineOnus.every((o) => o.status === 'offline')).toBe(true);
  });

  it('getOnuDetail works by id and returns fixture detail', async () => {
    const firstOnuId = (await client.listOnus())[0]!.id;
    const byId = await client.getOnuDetail(firstOnuId);
    expect(byId).not.toBeNull();
    expect(byId?.serial).toContain('SNMW');
  });

  it('getOnuDetail returns null for unknown identifier', async () => {
    const result = await client.getOnuDetail('NONEXISTENT');
    expect(result).toBeNull();
  });

  it('getOnusWithLowSignal flags degraded ONUs', async () => {
    const low = await client.getOnusWithLowSignal(-27);
    expect(low.length).toBeGreaterThan(0);
    expect(low.every((o) => (o.rxPowerDbm ?? 0) < -27)).toBe(true);
  });

  it('searchByCustomerName matches partial names case-insensitively', async () => {
    const matches = await client.searchByCustomerName('juan perez');
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.every((onu) => onu.customerName === 'Juan Perez')).toBe(true);
    await expect(client.searchByCustomerName('   ')).resolves.toEqual([]);
  });

  // Mikrowisp-specific methods

  it('listClients returns 25 fixture clients', async () => {
    const clientes = await client.listClients();
    expect(clientes).toHaveLength(25);
  });

  it('listClients filters by ACTIVO status', async () => {
    const activos = await client.listClients({ status: 'ACTIVO' });
    expect(activos.length).toBeGreaterThan(0);
    expect(activos.every((c) => c.estado === 'ACTIVO')).toBe(true);
  });

  it('listClients filters by SUSPENDIDO status', async () => {
    const suspendidos = await client.listClients({ status: 'SUSPENDIDO' });
    expect(suspendidos.length).toBeGreaterThan(0);
    expect(suspendidos.every((c) => c.estado === 'SUSPENDIDO')).toBe(true);
  });

  it('listClients filters by RETIRADO status', async () => {
    const retirados = await client.listClients({ status: 'RETIRADO' });
    expect(retirados.length).toBeGreaterThan(0);
    expect(retirados.every((c) => c.estado === 'RETIRADO')).toBe(true);
  });

  it('getOdbList returns 6 fixture ODBs', async () => {
    const odbs = await client.getOdbList();
    expect(odbs).toHaveLength(6);
    expect(odbs[0]?.nombre_odb).toBe('NAP-CENTRO-01');
  });

  it('listRouters returns raw fixture router data', async () => {
    const routers = await client.listRouters();
    expect(routers).toHaveLength(4);
    expect(routers[0]?.modelo).toBe('RB3011UiAS-RM');
    expect(routers[0]?.coordenadas).toBe('-34.6037,-58.3816');
  });
});
