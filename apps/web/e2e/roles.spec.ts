import { test, expect } from '@playwright/test';

test.describe('Roles & Permissions', () => {
  test('signup creates an owner session in the UI', async ({ page }) => {
    let signedIn = false;
    const user = {
      id: 'user-owner', email: 'owner@test.com', name: 'Test User', role: 'OWNER', tenantId: 'tenant-1',
      tenant: { id: 'tenant-1', name: 'Test ISP', slug: 'test-isp' },
    };
    await page.route('**/api/auth/me', (route) => route.fulfill({ json: { user: signedIn ? user : null } }));
    await page.route('**/api/auth/signup', (route) => {
      signedIn = true;
      return route.fulfill({ status: 201, json: { user, tenant: user.tenant } });
    });
    await page.route('**/api/connectors', (route) => route.fulfill({ json: { connectors: [] } }));

    await page.goto('/signup');
    await page.fill('input[type="email"]', user.email);
    await page.fill('input[type="password"]', 'Test1234!');
    await page.fill('input[placeholder="Tu nombre"]', user.name);
    await page.fill('input[placeholder="Nombre de tu ISP/empresa"]', user.tenant.name);
    await page.click('button[type="submit"]');

    await expect(page.getByText(user.email)).toBeVisible();
    await expect(page.getByText(user.tenant.name)).toBeVisible();
  });
});
