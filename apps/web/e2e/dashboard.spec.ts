import { test, expect } from '@playwright/test';

test.describe('Dashboard', () => {
  test('loads dashboard page', async ({ page }) => {
    await page.goto('http://localhost:3001/dashboard');
    await expect(page.locator('h1')).toContainText('Dashboard de Red');
  });

  test('shows OLT stats', async ({ page }) => {
    await page.goto('http://localhost:3001/dashboard');
    await expect(page.locator('text=OLTs')).toBeVisible();
  });

  test('shows link back to chat', async ({ page }) => {
    await page.goto('http://localhost:3001/dashboard');
    await expect(page.locator('a[href="/app"]')).toBeVisible();
  });
});
