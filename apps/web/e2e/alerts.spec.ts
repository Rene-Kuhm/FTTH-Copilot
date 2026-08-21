import { test, expect } from '@playwright/test';

const user = {
  id: 'user-1',
  email: 'owner@isp.test',
  name: 'Owner',
  role: 'OWNER',
  tenantId: 'tenant-1',
  tenant: { id: 'tenant-1', name: 'Test ISP', slug: 'test-isp' },
};

test.describe('Alerts', () => {
  test('renders the no-alerts state with its data source', async ({ page }) => {
    await page.route('**/api/auth/me', (route) => route.fulfill({ json: { user } }));
    await page.route('**/api/alerts', (route) => route.fulfill({
      json: {
        alerts: [],
        count: 0,
        dataSource: { mode: 'live', provider: 'SMARTOLT', label: 'SmartOLT prod' },
      },
    }));
    await page.route('**/api/connectors', (route) => route.fulfill({ json: { connectors: [] } }));
    await page.goto('/app');
    await expect(page.getByText('Sin alertas activas')).toBeVisible();
    await expect(page.getByText(/SmartOLT prod/)).toBeVisible();
  });
});
