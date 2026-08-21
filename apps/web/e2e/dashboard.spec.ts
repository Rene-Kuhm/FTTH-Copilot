import { test, expect } from '@playwright/test';

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/auth/me', (route) => route.fulfill({
      json: {
        user: {
          id: 'user-1', email: 'owner@isp.test', name: 'Owner', role: 'OWNER', tenantId: 'tenant-1',
          tenant: { id: 'tenant-1', name: 'Test ISP', slug: 'test-isp' },
        },
      },
    }));
    await page.route('**/api/dashboard**', (route) => route.fulfill({
      json: {
        dataSource: { mode: 'live', provider: 'SMARTOLT', label: 'SmartOLT prod' },
        overview: { totalOlts: 1, oltsOnline: 1, totalOnus: 2, onusOnline: 1, onusOffline: 1, averageUptimeSeconds: 3600, oltsWithHighTemperature: 0 },
        olts: [{ id: 'olt-1', name: 'OLT Norte', ip: '203.0.113.10', status: 'online', onusTotal: 2, onusOnline: 1, onusOffline: 1, onusDegraded: 0 }],
        statusDistribution: { online: 1, offline: 1, degraded: 0 },
      },
    }));
    await page.route('**/api/connectors', (route) => route.fulfill({ json: { connectors: [{ id: 'conn-1', provider: 'SMARTOLT', label: 'SmartOLT prod', baseUrl: 'https://api.smartolt.com', status: 'connected', lastCheckedAt: null, lastError: null, createdAt: new Date().toISOString() }] } }));
    await page.goto('/dashboard');
  });

  test('loads live dashboard stats', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Tablero de red' })).toBeVisible();
    await expect(page.getByText('Datos reales · SmartOLT prod')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'OLTs' })).toBeVisible();
  });

  test('shows link back to chat', async ({ page }) => {
    await expect(page.locator('a[href="/app"]')).toBeVisible();
  });
});
