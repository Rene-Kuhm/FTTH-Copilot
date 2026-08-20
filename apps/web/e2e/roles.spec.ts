import { test, expect } from '@playwright/test';

test.describe('Roles & Permissions', () => {
  test('signup creates owner user', async ({ page }) => {
    const email = `role-test-${Date.now()}@test.com`;
    await page.goto('http://localhost:3001');

    // Open the signup form (inputs are hidden until "Crear cuenta" is clicked)
    await page.click('button:has-text("Crear cuenta")');

    // Fill signup form
    await page.fill('input[placeholder*="email"], input[type="email"]', email);
    await page.fill('input[placeholder*="password"], input[type="password"]', 'Test1234!');
    await page.fill('input[placeholder*="nombre"], input[placeholder*="name"]', 'Test User');
    await page.fill('input[placeholder*="empresa"], input[placeholder*="ISP"]', 'Test ISP');

    // Submit
    await page.click('button[type="submit"]');
    await page.waitForTimeout(2000);

    // Should be logged in
    await expect(page.locator('text=Test User').or(page.locator('text=test-isp'))).toBeVisible({ timeout: 5000 });
  });
});
