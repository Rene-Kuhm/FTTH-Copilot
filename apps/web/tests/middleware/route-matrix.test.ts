import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// `NextResponse` extends Response, which Node provides natively. The cookie
// shim exists because the middleware clears the session cookie on the
// invalid-token branch.
vi.mock('next/server', () => {
  class NextResponse extends Response {
    cookies: {
      set: (options: { name: string; value: string; maxAge?: number }) => void;
      get: (name: string) => { name: string; value: string } | undefined;
    };

    constructor(body?: BodyInit | null, init?: ResponseInit) {
      super(body, init);
      const jar = new Map<string, string>();
      this.cookies = {
        set: ({ name, value }) => {
          jar.set(name, value);
          this.headers.append('set-cookie', `${name}=${value}`);
        },
        get: (name) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
      };
    }

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

/** Minimal NextRequest stand-in covering the fields the middleware reads. */
function request(
  pathname: string,
  {
    method = 'GET',
    cookies = {},
    headers = {},
  }: {
    method?: string;
    cookies?: Record<string, string>;
    headers?: Record<string, string>;
  } = {},
) {
  const url = new URL(`http://localhost:3000${pathname}`);
  return {
    method: method.toUpperCase(),
    url: url.toString(),
    headers: new Headers({
      ...(cookies[SESSION] ? { cookie: `${SESSION}=${cookies[SESSION]}` } : {}),
      ...(cookies['__test_bypass']
        ? { cookie: `__test_bypass=${cookies['__test_bypass']}` }
        : {}),
      ...(cookies['ftth_csrf'] ? { cookie: `ftth_csrf=${cookies['ftth_csrf']}` } : {}),
      ...headers,
    }),
    cookies: {
      get: (name: string) =>
        cookies[name] ? { name, value: cookies[name] } : undefined,
    },
    nextUrl: {
      pathname: url.pathname,
      searchParams: url.searchParams,
      origin: url.origin,
    },
  };
}

function claims(role: string) {
  return { userId: 'usr-1', tenantId: 'ten-1', role };
}

type RequestStandIn = ReturnType<typeof request>;

async function run(req: RequestStandIn) {
  return middleware(req as unknown as Parameters<typeof middleware>[0]);
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env['ENABLE_TEST_AUTH_BYPASS'];
  verifyToken.mockReturnValue(claims('OWNER'));
});

afterEach(() => {
  delete process.env['ENABLE_TEST_AUTH_BYPASS'];
});

describe('public routes', () => {
  it.each(['/', '/login', '/signup', '/manifest.json', '/sw.js'])(
    'lets %s through without a session',
    async (path) => {
      const res = await run(request(path));
      expect(res.status).toBe(200);
      expect(res.headers.get('location')).toBeNull();
    },
  );

  it('does not leak identity headers on a public route', async () => {
    const res = await run(request('/', { cookies: { [SESSION]: TOKEN } }));
    expect(res.headers.get('x-user-id')).toBeNull();
    expect(res.headers.get('x-user-role')).toBeNull();
  });
});

describe('protected routes', () => {
  it.each(['/dashboard', '/settings', '/plans', '/alerts'])(
    'redirects %s to login when unauthenticated',
    async (path) => {
      const res = await run(request(path));

      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toContain('/login');
      // The destination is preserved so the user returns where they wanted.
      expect(res.headers.get('location')).toContain(
        `redirect=${encodeURIComponent(path)}`,
      );
    },
  );

  it.each(['/dashboard', '/settings', '/plans', '/alerts'])(
    'admits %s with a valid session',
    async (path) => {
      const res = await run(request(path, { cookies: { [SESSION]: TOKEN } }));

      expect(res.status).toBe(200);
      expect(res.headers.get('x-user-id')).toBe('usr-1');
      expect(res.headers.get('x-tenant-id')).toBe('ten-1');
      expect(res.headers.get('x-user-role')).toBe('OWNER');
    },
  );

  it('redirects and clears the cookie when the token does not verify', async () => {
    verifyToken.mockReturnValue(null);

    const res = await run(request('/dashboard', { cookies: { [SESSION]: TOKEN } }));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login');
    expect(res.headers.get('set-cookie')).toContain(`${SESSION}=`);
  });

  it('passes the role through for any authenticated role', async () => {
    verifyToken.mockReturnValue(claims('MEMBER'));

    const res = await run(request('/dashboard', { cookies: { [SESSION]: TOKEN } }));

    expect(res.status).toBe(200);
    expect(res.headers.get('x-user-role')).toBe('MEMBER');
  });
});

describe('admin routes', () => {
  it.each(['/admin', '/admin/users', '/dashboard/admin', '/dashboard/admin/roles'])(
    'redirects %s to login when unauthenticated',
    async (path) => {
      const res = await run(request(path));

      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toContain('/login');
    },
  );

  it.each(['ADMIN', 'OWNER'])('admits %s', async (role) => {
    verifyToken.mockReturnValue(claims(role));

    const res = await run(request('/admin', { cookies: { [SESSION]: TOKEN } }));

    expect(res.status).toBe(200);
    expect(res.headers.get('x-user-role')).toBe(role);
  });

  it.each(['OPERATOR', 'MEMBER'])(
    'denies %s, which is authenticated but not an admin',
    async (role) => {
      verifyToken.mockReturnValue(claims(role));

      const res = await run(request('/dashboard/admin', { cookies: { [SESSION]: TOKEN } }));

      // Must not be admitted, and must not be treated as unauthenticated.
      expect(res.status).toBe(307);
      const location = res.headers.get('location') ?? '';
      expect(location).toContain('/dashboard');
      expect(location).toContain('insufficient_permissions');
      expect(res.headers.get('x-user-role')).toBeNull();
    },
  );

  it('denies an unverifiable token the same as an absent one', async () => {
    verifyToken.mockReturnValue(null);

    const res = await run(request('/admin', { cookies: { [SESSION]: TOKEN } }));

    expect(res.headers.get('location')).toContain('/login');
  });
});

describe('test auth bypass', () => {
  // Regression: the bypass used to be unconditional, so any client could send
  // one header or cookie and walk past authentication and RBAC in production.
  it.each(['/admin', '/dashboard', '/dashboard/admin'])(
    'ignores the bypass header on %s while the flag is off',
    async (path) => {
      const res = await run(request(path, { headers: { 'x-playwright-test': 'true' } }));

      expect(res.headers.get('x-test-mode')).toBeNull();
      expect(res.status).toBe(307);
    },
  );

  it.each(['/admin', '/dashboard'])(
    'ignores the bypass cookie on %s while the flag is off',
    async (path) => {
      const res = await run(request(path, { cookies: { __test_bypass: 'true' } }));

      expect(res.headers.get('x-test-mode')).toBeNull();
      expect(res.status).toBe(307);
    },
  );

  it('still refuses a protected route when the flag is off', async () => {
    process.env['ENABLE_TEST_AUTH_BYPASS'] = 'false';
    const res = await run(request('/admin', { cookies: { __test_bypass: 'true' } }));
    expect(res.headers.get('x-test-mode')).toBeNull();
  });

  it('honours the header when the flag is explicitly enabled', async () => {
    process.env['ENABLE_TEST_AUTH_BYPASS'] = 'true';

    const res = await run(request('/admin', { headers: { 'x-playwright-test': 'true' } }));

    expect(res.status).toBe(200);
    expect(res.headers.get('x-test-mode')).toBe('true');
  });

  it('honours the cookie when the flag is explicitly enabled', async () => {
    process.env['ENABLE_TEST_AUTH_BYPASS'] = 'true';

    const res = await run(request('/dashboard', { cookies: { __test_bypass: 'true' } }));

    expect(res.status).toBe(200);
    expect(res.headers.get('x-test-mode')).toBe('true');
  });
});

describe('security headers', () => {
  it.each([
    ['public', '/'],
    ['protected, unauthenticated', '/dashboard'],
    ['admin, unauthenticated', '/admin'],
  ])('sets hardening headers on a %s response', async (_label, path) => {
    const res = await run(request(path));

    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'self'");
  });
});
