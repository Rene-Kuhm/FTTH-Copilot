import { test, expect } from '@playwright/test';

/**
 * E2E OIDC / SSO flow against a local Keycloak instance (`docker compose --profile oidc up -d keycloak`).
 *
 * Requires:
 *   OIDC_E2E_ENABLED=true
 *   OIDC_ENABLED=true
 *   OIDC_ISSUER=http://localhost:8085/realms/ftth-demo
 *   OIDC_CLIENT_ID=ftth-copilot-web
 *   OIDC_CLIENT_SECRET=ftth-dev-oidc-secret
 *   OIDC_REDIRECT_URI=http://localhost:3001/api/auth/oidc/callback
 *   OIDC_TENANT_SLUG=demo
 *   OIDC_ALLOWED_EMAIL_DOMAINS=ftth-demo.example
 *   OIDC_AUTO_PROVISION=true
 *   OIDC_ROLE_CLAIM=groups
 *   OIDC_ROLE_MAP=noc-admins:ADMIN,noc-ops:OPERATOR
 */
const OIDC_E2E = process.env['OIDC_E2E_ENABLED'] === 'true';

test.describe('OIDC / SSO flow (Keycloak)', () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test.skip(!OIDC_E2E, 'Set OIDC_E2E_ENABLED=true with Keycloak profile running to execute');

  test('login via SSO -> callback -> /app dashboard -> logout', async ({ page }) => {
    await page.goto('/login');
    const ssoButton = page.getByRole('link', { name: /Ingresar con SSO/i });
    await expect(ssoButton).toBeVisible();
    await ssoButton.click();

    await page.waitForURL(/\/realms\/ftth-demo\/protocol\/openid-connect\/auth/);
    await page.fill('#username', 'operator');
    await page.fill('#password', 'dev-operator-password');
    await page.click('#kc-login');

    await page.waitForURL(/\/app/);
    await expect(page).toHaveURL(/\/app/);

    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/dashboard/);

    const logoutBtn = page.getByRole('button', { name: /Salir/i });
    await expect(logoutBtn).toBeVisible();
    await logoutBtn.click();
    await expect(logoutBtn).not.toBeVisible();
    await page.reload();
    await page.waitForURL(/\/login/);
  });

  test('rejects SSO login when email domain is not in OIDC_ALLOWED_EMAIL_DOMAINS', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('link', { name: /Ingresar con SSO/i }).click();

    await page.waitForURL(/\/realms\/ftth-demo\/protocol\/openid-connect\/auth/);
    await page.fill('#username', 'outsider');
    await page.fill('#password', 'dev-outsider-password');
    await page.click('#kc-login');

    await page.waitForURL(/\/login\?error=oidc_domain_not_allowed/);
    await expect(page.getByRole('alert').filter({ hasText: /dominio/i })).toBeVisible();
  });
});
