import { test, expect } from '@playwright/test';

test.describe('Alerts', () => {
  test('alerts panel loads on main page', async ({ page }) => {
    await page.goto('http://localhost:3001');
    // Wait for alerts to load
    await page.waitForTimeout(1000);
    // Should see either alerts or no-alerts state
    const alertsPanel = page.locator('text=Alertas de Red');
    const noAlerts = page.locator('text=Sin alertas');
    // At least one should be visible (or neither if loading)
    await expect(alertsPanel.or(noAlerts)).toBeVisible({ timeout: 5000 });
  });
});
