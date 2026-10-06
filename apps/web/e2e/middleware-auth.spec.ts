import { expect, test } from '@playwright/test';

/**
 * The middleware, exercised for real.
 *
 * global-setup seeds every E2E context with the __test_bypass cookie so the UI
 * can be driven without a session. That made the whole suite blind to the
 * middleware itself: when Edge verification was broken and every protected
 * route answered 307, all E2E tests still passed green.
 *
 * These tests clear the bypass cookie, so they run against the same code path a
 * browser hits in production. They are the regression net for that class of
 * failure.
 */

const PROTECTED = ['/app', '/dashboard', '/settings', '/plans', '/alerts'] as const;

/** Drop the bypass so the middleware has to do its job. */
async function withoutBypass(page: import('@playwright/test').Page) {
  await page.context().clearCookies();
}

test.describe('middleware auth, with the test bypass disabled', () => {
  test('redirects every protected route to login without a session', async ({ page }) => {
    await withoutBypass(page);

    for (const route of PROTECTED) {
      await page.goto(route);
      const url = new URL(page.url());
      expect(url.pathname, `${route} should land on /login`).toBe('/login');
      // The destination is preserved so the operator returns where they wanted.
      expect(url.searchParams.get('redirect')).toBe(route);
    }
  });

  test('admits the same routes once a real session exists', async ({ page }) => {
    await withoutBypass(page);

    const login = await page.request.post('/api/auth/login', {
      data: { email: process.env.E2E_LOGIN_EMAIL, password: process.env.E2E_LOGIN_PASSWORD },
    });
    expect(login.status()).toBe(200);

    for (const route of PROTECTED) {
      const response = await page.request.get(route);
      expect(response.status(), `${route} should be reachable with a session`).not.toBe(307);
    }
  });

  test('propagates the identity headers the server components read', async ({ page }) => {
    await withoutBypass(page);

    const login = await page.request.post('/api/auth/login', {
      data: { email: process.env.E2E_LOGIN_EMAIL, password: process.env.E2E_LOGIN_PASSWORD },
    });
    expect(login.status()).toBe(200);

    const response = await page.request.get('/app');

    // The middleware reads `sub`, not `userId`. When it read the wrong field
    // these headers were undefined and server components saw no identity.
    expect(response.headers()['x-user-id']).toBeTruthy();
    expect(response.headers()['x-user-tenant'] ?? response.headers()['x-tenant-id']).toBeTruthy();
    expect(response.headers()['x-user-role']).toBeTruthy();
  });

  test('keeps the CSRF gate closed on a mutation without the header', async ({ page }) => {
    await withoutBypass(page);

    await page.request.post('/api/auth/login', {
      data: { email: process.env.E2E_LOGIN_EMAIL, password: process.env.E2E_LOGIN_PASSWORD },
    });

    // Session present, CSRF header absent: the gate must still refuse.
    const response = await page.request.post('/api/zones', { data: {} });

    expect(response.status()).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: 'Invalid CSRF token',
    });
  });

  test('carries hardening headers on the unauthenticated redirect', async ({ page }) => {
    await withoutBypass(page);

    const response = await page.request.get('/dashboard', { maxRedirects: 0 });

    expect(response.status()).toBe(307);
    expect(response.headers()['x-frame-options']).toBe('DENY');
    expect(response.headers()['x-content-type-options']).toBe('nosniff');
  });
});