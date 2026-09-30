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

  it('getOltDetail returns the OLT with subscribersConnected count', async () => {
    const detail = await client.getOltDetail('RT-BSAS-01');
    expect(detail.id).toBe('RT-BSAS-01');
    expect(detail.name).toBe('MikroTik-RB3011-Centro');
    expect(detail.subscribersConnected).toBeGreaterThanOrEqual(1);
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

  // ── Fase ODN-2: OdnComponent mapping ──

  it('getOdnComponents returns 6 NAP components parented to their OLT routers', async () => {
    const components = await client.getOdnComponents();
    expect(components).toHaveLength(6);
    const first = components[0];
    expect(first).toBeDefined();
    expect(first?.kind).toBe('NAP');
    expect(first?.id).toBe('ODB-01');
    expect(first?.label).toBe('NAP-CENTRO-01');
    expect(first?.parentId).toBe('RT-BSAS-01');
    expect(first?.splitRatio).toBe(16);
    expect(first?.attenuationDb).toBe(17.5);
    expect(first?.sourceId).toBe('mikrowisp-odb');
  });

  it('getOdnComponents maps split ratios correctly across all fixtures', async () => {
    const components = await client.getOdnComponents();
    const ratios = components.map((c) => c.splitRatio);
    expect(ratios).toEqual([16, 16, 8, 16, 32, 8]);
  });

  it('getOdnComponents associates NAP-CENTRO and NAP-NORTE with the same parent OLT', async () => {
    const components = await client.getOdnComponents();
    const centro = components.find((c) => c.label === 'NAP-CENTRO-01');
    const norte = components.find((c) => c.label === 'NAP-NORTE-02');
    expect(centro?.parentId).toBe('RT-BSAS-01');
    expect(norte?.parentId).toBe('RT-BSAS-01');
    expect(centro?.parentId).toBe(norte?.parentId);
  });

  it('getOdbList remains unchanged for backward compatibility', async () => {
    // getOdbList and getOdnComponents coexist; consumers choose based on need
    const odbs = await client.getOdbList();
    const components = await client.getOdnComponents();
    expect(odbs).toHaveLength(components.length);
    expect(odbs[0]?.id).toBe(components[0]?.id);
  });

  it('listRouters returns raw fixture router data', async () => {
    const routers = await client.listRouters();
    expect(routers).toHaveLength(4);
    expect(routers[0]?.modelo).toBe('RB3011UiAS-RM');
    expect(routers[0]?.coordenadas).toBe('-34.6037,-58.3816');
  });
});
