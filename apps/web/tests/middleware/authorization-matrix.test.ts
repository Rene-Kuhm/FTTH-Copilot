import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * La matriz ruta x método x rol del middleware.
 *
 * El middleware decide con tres variables: la ruta (que clase es), el método
 * HTTP (que_gate de CSRF corre) y el rol de la sesión (si alcanza para
 * entrar). Los otros dos archivos de esta carpeta cubren una dimensión cada
 * uno —`route-matrix.test.ts` la ruta y el rol, `csrf-gate.test.ts` el
 * método— pero ninguna los ponía juntos.
 *
 * Esta tabla los cruza: para cada ruta, cada método y cada identidad
 * (anónimo más cada rol) declara qué tiene que responder el middleware. Un
 * cambio en la clasificación de una ruta, en la jerarquía de roles o en el
 * gate de CSRF rompe la tabla, no un caso suelto.
 *
 * Las rutas de API son el caso interesante: el middleware no les exige
 * sesión (la autorización vive en la ruta) y sí les exige CSRF en las
 * mutaciones. La tabla fija esa frontera para que nadie la lea al revés.
 */

// `NextResponse` extends Response, which Node provides natively.
vi.mock('next/server', () => {
  class NextResponse extends Response {
    static next(): NextResponse {
      return new NextResponse(null, { status: 200 });
    }
    static redirect(url: string | URL): NextResponse {
      return new NextResponse(null, {
        status: 307,
        headers: { location: String(url) },
      });
    }
  }
  return { NextResponse };
});

// The rate limiter and the JWT decoder have their own behaviour; neither
// belongs in a matrix about authorization.
vi.mock('../../middleware/rate-limit', () => ({
  checkRateLimit: () => ({ allowed: true, remaining: 99, resetAt: 0 }),
  getRateLimitKey: () => 'test-key',
  rateLimitResponse: () => new Response(null, { status: 429 }),
  RATE_LIMITS: { auth: {}, normal: {} },
}));

const verifyToken = vi.hoisted(() => vi.fn());
vi.mock('../../middleware/jwt-verify', () => ({ verifyToken }));

const { middleware } = await import('../../middleware');

const SESSION = 'ftth_session';
const TOKEN = 'a'.repeat(64);
const CSRF = 'b'.repeat(64);

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

/**
 * How the middleware classifies a route.
 *
 * - `page-public`: a page anyone may see.
 * - `api-public`: an API route the middleware exempts (`/api/health` skips
 *   everything, `/api/auth/*` validates its own input).
 * - `api`: an API route the middleware only rate-limits and CSRF-guards.
 * - `protected`: a page that needs a valid session.
 * - `admin`: a page that needs a session with ADMIN or OWNER.
 */
type RouteKind = 'page-public' | 'api-public' | 'api' | 'protected' | 'admin';

const ROUTES: { path: string; kind: RouteKind }[] = [
  { path: '/', kind: 'page-public' },
  { path: '/login', kind: 'page-public' },
  { path: '/api/health', kind: 'api-public' },
  { path: '/api/auth/login', kind: 'api-public' },
  { path: '/api/alerts', kind: 'api' },
  { path: '/api/zones', kind: 'api' },
  { path: '/app', kind: 'protected' },
  { path: '/dashboard', kind: 'protected' },
  { path: '/admin', kind: 'admin' },
  { path: '/dashboard/admin', kind: 'admin' },
];

/** The identity in the session. `null` means "no session at all". */
const IDENTITIES: { label: string; role: string | null }[] = [
  { label: 'anonymous', role: null },
  { label: 'MEMBER', role: 'MEMBER' },
  { label: 'OPERATOR', role: 'OPERATOR' },
  { label: 'ADMIN', role: 'ADMIN' },
  { label: 'OWNER', role: 'OWNER' },
  { label: 'an unknown role', role: 'SOMEONE_ELSE' },
];

/** What the middleware has to answer. */
type Outcome = 'pass' | 'login' | 'insufficient-permissions' | 'invalid-csrf';

const MUTATIONS = ['POST', 'PUT', 'PATCH', 'DELETE'];

function expectedOutcome(
  kind: RouteKind,
  method: string,
  role: string | null,
  withCsrf: boolean,
): Outcome {
  switch (kind) {
    case 'page-public':
    case 'api-public':
      return 'pass';
    case 'api':
      // The middleware does not authorize API routes: that lives in the
      // route handler. It only guards the mutations with CSRF.
      return MUTATIONS.includes(method) && !withCsrf ? 'invalid-csrf' : 'pass';
    case 'protected':
      return role === null ? 'login' : 'pass';
    case 'admin':
      if (role === null) return 'login';
      return role === 'ADMIN' || role === 'OWNER' ? 'pass' : 'insufficient-permissions';
  }
}

/** Minimal NextRequest stand-in covering the fields the middleware reads. */
function request(
  pathname: string,
  {
    method = 'GET',
    role = null,
    withCsrf = false,
  }: { method?: string; role?: string | null; withCsrf?: boolean } = {},
) {
  const url = new URL(`http://localhost:3000${pathname}`);
  const cookieParts: string[] = [];
  if (role !== null) cookieParts.push(`${SESSION}=${TOKEN}`);
  if (withCsrf) cookieParts.push(`ftth_csrf=${CSRF}`);

  return {
    method: method.toUpperCase(),
    url: url.toString(),
    headers: new Headers({
      ...(cookieParts.length > 0 ? { cookie: cookieParts.join('; ') } : {}),
      ...(withCsrf ? { 'x-csrf-token': CSRF } : {}),
    }),
    cookies: {
      get: (name: string) =>
        name === SESSION && role !== null ? { name, value: TOKEN } : undefined,
    },
    nextUrl: {
      pathname: url.pathname,
      searchParams: url.searchParams,
      origin: url.origin,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env['ENABLE_TEST_AUTH_BYPASS'];
  verifyToken.mockImplementation(() => ({
    userId: 'usr-1',
    tenantId: 'ten-1',
    role: 'OWNER',
  }));
});

describe('matriz ruta x método x rol', () => {
  for (const route of ROUTES) {
    describe(`${route.path} (${route.kind})`, () => {
      for (const method of METHODS) {
        it(`responde lo mismo a cada rol con ${method}`, async () => {
          for (const identity of IDENTITIES) {
            verifyToken.mockReturnValue({
              userId: 'usr-1',
              tenantId: 'ten-1',
              role: identity.role ?? 'OWNER',
            });

            const res = await middleware(
              request(route.path, {
                method,
                role: identity.role,
                withCsrf: true,
              }) as unknown as Parameters<typeof middleware>[0],
            );

            const expected = expectedOutcome(route.kind, method, identity.role, true);
            const label = `${route.path} ${method} as ${identity.label}`;

            if (expected === 'pass') {
              expect(res.status, label).toBe(200);
              expect(res.headers.get('location'), label).toBeNull();
              continue;
            }
            if (expected === 'login') {
              expect(res.status, label).toBe(307);
              expect(res.headers.get('location'), label).toContain('/login');
              continue;
            }
            if (expected === 'insufficient-permissions') {
              expect(res.status, label).toBe(307);
              expect(res.headers.get('location'), label).toContain('insufficient_permissions');
              continue;
            }
            expect(res.status, label).toBe(403);
          }
        });
      }
    });
  }
});

describe('gate de CSRF en las rutas de API', () => {
  for (const route of ROUTES.filter((r) => r.kind === 'api')) {
    for (const method of METHODS) {
      it(`${route.path} con ${method} rechaza la mutación sin el header CSRF`, async () => {
        const expected = expectedOutcome('api', method, 'OWNER', false);

        const res = await middleware(
          request(route.path, { method, role: 'OWNER', withCsrf: false }) as unknown as Parameters<
            typeof middleware
          >[0],
        );

        if (MUTATIONS.includes(method)) {
          expect(res.status).toBe(403);
          await expect(res.json()).resolves.toMatchObject({
            error: 'Invalid CSRF token',
          });
        } else {
          expect(res.status).toBe(expected === 'pass' ? 200 : 403);
        }
      });
    }
  }
});

describe('frontera de la autorización', () => {
  it('no exige rol en las rutas de API: la autorización vive en la ruta', async () => {
    const res = await middleware(
      request('/api/alerts', { role: null }) as unknown as Parameters<typeof middleware>[0],
    );

    expect(res.status).toBe(200);
  });

  it('admite cualquier rol autenticado en una ruta protegida', async () => {
    for (const identity of IDENTITIES.filter((i) => i.role !== null)) {
      verifyToken.mockReturnValue({
        userId: 'usr-1',
        tenantId: 'ten-1',
        role: identity.role,
      });

      const res = await middleware(
        request('/dashboard', { role: identity.role }) as unknown as Parameters<
          typeof middleware
        >[0],
      );

      expect(res.status, identity.label).toBe(200);
    }
  });

  it('exige ADMIN u OWNER en las rutas de admin', async () => {
    for (const identity of IDENTITIES.filter((i) => i.role !== null)) {
      verifyToken.mockReturnValue({
        userId: 'usr-1',
        tenantId: 'ten-1',
        role: identity.role,
      });

      const res = await middleware(
        request('/admin', { role: identity.role }) as unknown as Parameters<
          typeof middleware
        >[0],
      );

      const admitted = identity.role === 'ADMIN' || identity.role === 'OWNER';
      expect(res.status, identity.label).toBe(admitted ? 200 : 307);
      if (!admitted) {
        expect(res.headers.get('location')).toContain('insufficient_permissions');
      }
    }
  });
});
