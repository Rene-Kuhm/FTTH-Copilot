import { describe, it, expect, vi, beforeEach } from 'vitest';

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

// Keep these concerns out of the assertions: rate limiting and JWT decoding
// have their own behaviour, and neither belongs in a CSRF gate test.
vi.mock('../../middleware/rate-limit', () => ({
  checkRateLimit: () => true,
  getRateLimitKey: () => 'test-key',
  rateLimitResponse: () => new Response(null, { status: 429 }),
  RATE_LIMITS: { auth: {}, normal: {} },
}));

vi.mock('../../middleware/jwt-verify', () => ({
  verifyToken: () => null,
}));

const { middleware } = await import('../../middleware');

const TOKEN = 'a'.repeat(64);
const CSRF_COOKIE = `ftth_csrf=${TOKEN}`;

/** Minimal NextRequest stand-in: the middleware only reads these fields. */
function makeRequest(
  pathname: string,
  {
    method = 'GET',
    headers = {},
  }: { method?: string; headers?: Record<string, string> } = {},
) {
  const url = new URL(`http://localhost:3000${pathname}`);
  return {
    method: method.toUpperCase(),
    headers: new Headers(headers),
    cookies: {
      get: (name: string) =>
        name === 'ftth_csrf' ? { name, value: TOKEN } : undefined,
    },
    nextUrl: {
      pathname: url.pathname,
      searchParams: url.searchParams,
      origin: url.origin,
      clone: () => new URL(url),
    },
  };
}

describe('middleware CSRF gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects a mutation with no CSRF header', async () => {
    const response = await middleware(
      makeRequest('/api/zones', { method: 'POST' }) as never,
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: 'Invalid CSRF token',
    });
  });

  it('rejects a mutation whose header does not match the cookie', async () => {
    const response = await middleware(
      makeRequest('/api/zones', {
        method: 'POST',
        headers: { cookie: CSRF_COOKIE, 'x-csrf-token': 'b'.repeat(64) },
      }) as never,
    );

    expect(response.status).toBe(403);
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    'admits %s when the header matches the cookie',
    async (method) => {
      const response = await middleware(
        makeRequest('/api/zones', {
          method,
          headers: { cookie: CSRF_COOKIE, 'x-csrf-token': TOKEN },
        }) as never,
      );

      expect(response.status).not.toBe(403);
    },
  );

  it('admits a mutation when other cookies precede the CSRF cookie', async () => {
    const response = await middleware(
      makeRequest('/api/zones', {
        method: 'POST',
        headers: {
          cookie: `ftth_session=abc; ${CSRF_COOKIE}`,
          'x-csrf-token': TOKEN,
        },
      }) as never,
    );

    expect(response.status).not.toBe(403);
  });

  it('admits safe methods without a CSRF header', async () => {
    const response = await middleware(makeRequest('/api/zones') as never);

    expect(response.status).not.toBe(403);
  });

  it('exempts the auth endpoints, which validate their own input', async () => {
    const response = await middleware(
      makeRequest('/api/auth/login', { method: 'POST' }) as never,
    );

    expect(response.status).not.toBe(403);
  });

  it('sets hardening headers on the rejection', async () => {
    const response = await middleware(
      makeRequest('/api/zones', { method: 'POST' }) as never,
    );

    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('content-security-policy')).toContain(
      "default-src 'self'",
    );
  });
});