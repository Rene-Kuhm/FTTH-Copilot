import { test, expect, request } from '@playwright/test';

/**
 * RED tests for the real backend auth contract.
 *
 * The previous `auth.spec.ts` mocked every `/api/auth/*` route via
 * `page.route()`. That meant the UI handling of `set-cookie`, the
 * server-side bcrypt verification, the session row insertion, the
 * `/me` lookup that reads the session, and the `/logout` that
 * `deleteMany`s the session row — none of them were tested.
 *
 * This spec exercises those backend paths against the running Next.js
 * server with real HTTP requests via Playwright's `request` fixture.
 * No `page.route()` mocking. The signup endpoint creates the user
 * and the tenant in Postgres; the login endpoint inserts the session
 * row; the me endpoint reads it; the logout endpoint deletes it.
 *
 * The bug-report quote:
 *   "las pruebas de autenticación de Playwright reemplazan las API
 *    con respuestas simuladas: comprueban la interfaz, pero no el
 *    login real ni la revocación de sesiones."
 *
 * The existing `auth.spec.ts` is preserved as `auth-ui.spec.ts` (UI
 * coverage with mocks). Both run in CI.
 *
 * JWT determinism caveat:
 *   JWT tokens issued by `issueToken(userId, tenantId, role)` are
 *   byte-identical when the iat and exp epoch-seconds match. Two
 *   consecutive login calls within the same second produce the
 *   same JWT → the same `tokenHash` → Prisma P2002 (unique
 *   constraint on Session.tokenHash). To avoid that, every login
 *   call in this spec is preceded by `await sleepForJwtEpoch()`,
 *   a 1100 ms sleep that guarantees the iat rolls into the next
 *   second. This is the smallest change that makes the suite
 *   deterministic; cleaning the Session table between tests would
 *   require importing Prisma into the spec, which is out of scope.
 */

interface MeResponse {
  user: {
    id: string;
    email: string;
    name: string | null;
    role: string;
    tenantId: string;
    tenant: { id: string; name: string; slug: string };
  } | null;
}

const UNIQUE = (label: string): string =>
  `${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@e2e.test`;

const PASSWORD = 'correct-horse-battery-staple';

const JWT_EPOCH_JUMP_MS = 1100;
async function sleepForJwtEpoch(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, JWT_EPOCH_JUMP_MS));
}

test.describe('Auth backend — real HTTP, no mocks', () => {
  test('signup creates the user and tenant; me responds with the user', async ({ baseURL }) => {
    const ctx = await request.newContext({ baseURL });
    const email = UNIQUE('signup-ok');

    const signupRes = await ctx.post('/api/auth/signup', {
      data: {
        email,
        password: PASSWORD,
        name: 'E2E User',
        tenantName: `E2E Tenant ${Date.now()}`,
      },
    });
    expect(signupRes.status()).toBe(201);
    const setCookie = signupRes.headers()['set-cookie'];
    expect(setCookie).toBeDefined();
    expect(setCookie!.split(';')[0]).toMatch(/session=/);

    await sleepForJwtEpoch();
    const meRes = await ctx.get('/api/auth/me');
    expect(meRes.status()).toBe(200);
    const me = (await meRes.json()) as MeResponse;
    expect(me.user).not.toBeNull();
    expect(me.user!.email).toBe(email);
    expect(me.user!.role).toBe('OWNER');

    await ctx.dispose();
  });

  test('login with valid credentials returns a session cookie', async ({ baseURL }) => {
    const ctx = await request.newContext({ baseURL });
    const email = UNIQUE('login-ok');

    await ctx.post('/api/auth/signup', {
      data: {
        email,
        password: PASSWORD,
        name: 'E2E Login User',
        tenantName: `E2E Login Tenant ${Date.now()}`,
      },
    });

    await sleepForJwtEpoch();
    const loginRes = await ctx.post('/api/auth/login', {
      data: { email, password: PASSWORD },
    });
    expect(loginRes.status()).toBe(200);
    const setCookie = loginRes.headers()['set-cookie'];
    expect(setCookie).toBeDefined();
    expect(setCookie!.split(';')[0]).toMatch(/session=/);

    await ctx.dispose();
  });

  test('login with wrong password returns 401 and does NOT set a cookie', async ({ baseURL }) => {
    const ctx = await request.newContext({ baseURL });
    const email = UNIQUE('login-bad');

    await ctx.post('/api/auth/signup', {
      data: {
        email,
        password: PASSWORD,
        name: 'E2E Bad Login',
        tenantName: `E2E Bad Tenant ${Date.now()}`,
      },
    });

    await sleepForJwtEpoch();
    const loginRes = await ctx.post('/api/auth/login', {
      data: { email, password: 'wrong-password-here' },
    });
    expect(loginRes.status()).toBe(401);
    const body = (await loginRes.json()) as { error?: string };
    expect(body.error).toMatch(/invalid|cred/i);
    expect(loginRes.headers()['set-cookie']).toBeUndefined();

    await ctx.dispose();
  });

  test('logout deletes the session — subsequent /me returns user=null', async ({ baseURL }) => {
    const ctx = await request.newContext({ baseURL });
    const email = UNIQUE('logout');

    await ctx.post('/api/auth/signup', {
      data: {
        email,
        password: PASSWORD,
        name: 'E2E Logout User',
        tenantName: `E2E Logout Tenant ${Date.now()}`,
      },
    });
    await sleepForJwtEpoch();
    await ctx.post('/api/auth/login', {
      data: { email, password: PASSWORD },
    });

    const meBefore = await ctx.get('/api/auth/me');
    expect((await meBefore.json() as MeResponse).user).not.toBeNull();

    const logoutRes = await ctx.post('/api/auth/logout');
    expect(logoutRes.status()).toBe(200);
    expect(logoutRes.headers()['set-cookie']).toMatch(/Max-Age=0/);

    const meAfter = await ctx.get('/api/auth/me');
    expect(meAfter.status()).toBe(200);
    expect((await meAfter.json() as MeResponse).user).toBeNull();

    await ctx.dispose();
  });

  test('a logged-out cookie cannot be reused to revive a session (token is gone)', async ({ baseURL }) => {
    const ctx = await request.newContext({ baseURL });
    const email = UNIQUE('reuse');

    await ctx.post('/api/auth/signup', {
      data: {
        email,
        password: PASSWORD,
        name: 'E2E Reuse',
        tenantName: `E2E Reuse Tenant ${Date.now()}`,
      },
    });
    await sleepForJwtEpoch();
    const loginRes = await ctx.post('/api/auth/login', {
      data: { email, password: PASSWORD },
    });
    const cookieHeader = loginRes.headers()['set-cookie']!.split(';')[0];

    await ctx.post('/api/auth/logout');

    const meRes = await ctx.get('/api/auth/me', {
      headers: { cookie: cookieHeader },
    });
    expect(meRes.status()).toBe(200);
    expect((await meRes.json() as MeResponse).user).toBeNull();

    await ctx.dispose();
  });
});
