import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Coverage for `lib/auth/server.ts`, which had none at all: signup, login,
 * logout, session resolution.
 *
 * The emphasis is on the security properties rather than the happy path,
 * because this is the authentication boundary. What matters here is not that
 * login returns 200, but that a wrong password and an unknown email are
 * indistinguishable, that sessions are stored hashed, that a token whose claims
 * no longer match its session row is refused, and that logout really
 * invalidates the server-side session.
 */

const mocks = vi.hoisted(() => ({
  prisma: {
    user: { findUnique: vi.fn(), create: vi.fn() },
    tenant: { create: vi.fn() },
    session: { create: vi.fn(), deleteMany: vi.fn(), findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
  hashPassword: vi.fn(),
  verifyPassword: vi.fn(),
  issueToken: vi.fn(),
  verifyToken: vi.fn(),
  hashToken: vi.fn(),
  checkAuthQuota: vi.fn(),
  recordAuthAttempt: vi.fn(),
  authRateLimitKeys: vi.fn(),
  sessionCookieAttributes: vi.fn(),
  extractClientIp: vi.fn(),
  decryptApiKey: vi.fn(),
  auditLogin: vi.fn(),
  cookieJar: new Map<string, string>(),
}));

vi.mock('@ftth-copilot/db', () => ({
  prisma: mocks.prisma,
  hashPassword: mocks.hashPassword,
  verifyPassword: mocks.verifyPassword,
  issueToken: mocks.issueToken,
  verifyToken: mocks.verifyToken,
  hashToken: mocks.hashToken,
  COOKIE_NAME: 'ftth_session',
  TOKEN_TTL_SECONDS: 3600,
  checkAuthQuota: mocks.checkAuthQuota,
  recordAuthAttempt: mocks.recordAuthAttempt,
  authRateLimitKeys: mocks.authRateLimitKeys,
  extractClientIp: mocks.extractClientIp,
  decryptApiKey: mocks.decryptApiKey,
  sessionCookieAttributes: mocks.sessionCookieAttributes,
}));

vi.mock('@ftth-copilot/soc', () => ({
  auditAuth: { login: mocks.auditLogin },
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      mocks.cookieJar.has(name) ? { name, value: mocks.cookieJar.get(name) } : undefined,
  }),
}));

const { handleSignup, handleLogin, handleLogout, handleMe, getCurrentUser } =
  await import('@/lib/auth/server');

const SESSION_COOKIE = 'ftth_session';

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function dbUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'usr-1',
    email: 'user@example.com',
    name: 'User',
    role: 'OWNER',
    tenantId: 'ten-1',
    passwordHash: 'hash-1',
    mfaEnabled: false,
    totpSecret: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cookieJar.clear();

  mocks.hashPassword.mockResolvedValue('hashed');
  mocks.verifyPassword.mockResolvedValue(true);
  mocks.hashToken.mockImplementation((t: string) => `sha256:${t}`);
  mocks.extractClientIp.mockReturnValue('203.0.113.9');
  mocks.checkAuthQuota.mockResolvedValue({ allowed: true, retryAfter: 60 });
  mocks.recordAuthAttempt.mockResolvedValue(undefined);
  mocks.authRateLimitKeys.mockReturnValue(['auth:ip:203.0.113.9']);
  mocks.sessionCookieAttributes.mockReturnValue({
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: false,
    maxAge: 3600,
  });
  mocks.issueToken.mockReturnValue({
    token: 'raw-token',
    tokenHash: 'sha256:raw-token',
    expiresAt: new Date(Date.now() + 3600_000),
  });
  mocks.decryptApiKey.mockReturnValue('JBSWY3DPEHPK3PXP');
  mocks.prisma.user.findUnique.mockResolvedValue(dbUser());
  mocks.prisma.session.create.mockResolvedValue({});
  mocks.prisma.session.deleteMany.mockResolvedValue({ count: 1 });
  mocks.prisma.tenant.create.mockResolvedValue({ id: 'ten-1', name: 'Acme', slug: 'acme-x' });
  mocks.prisma.user.create.mockResolvedValue(dbUser());
  mocks.prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
    fn({
      tenant: { create: mocks.prisma.tenant.create },
      user: { create: mocks.prisma.user.create },
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('handleSignup', () => {
  beforeEach(() => {
    // No pre-existing account, unless a test says otherwise.
    mocks.prisma.user.findUnique.mockResolvedValue(null);
  });

  it('rejects a malformed body', async () => {
    const res = await handleSignup(post('{not json'));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'Invalid JSON body' });
  });

  it('rejects an invalid email or a short password', async () => {
    const res = await handleSignup(
      post({ email: 'nope', password: 'short', name: 'X', tenantName: 'Acme' }),
    );
    expect(res.status).toBe(400);
  });

  it('rate-limits account creation per client IP', async () => {
    mocks.checkAuthQuota.mockResolvedValue({ allowed: false, retryAfter: 120 });

    const res = await handleSignup(
      post({ email: 'a@b.com', password: 'longenough1', name: 'X', tenantName: 'Acme' }),
    );

    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('120');
    // The account must not be created when the quota is exhausted.
    expect(mocks.prisma.user.create).not.toHaveBeenCalled();
  });

  it('creates the tenant and an OWNER user, and returns 201', async () => {
    const res = await handleSignup(
      post({ email: 'a@b.com', password: 'longenough1', name: 'X', tenantName: 'Acme' }),
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.user.role).toBe('OWNER');
    expect(body.tenant.id).toBe('ten-1');
    // The password hash must never leave the server.
    expect(JSON.stringify(body)).not.toMatch(/hashed|password/i);
  });

  it('stores a session and sets the session and CSRF cookies', async () => {
    const res = await handleSignup(
      post({ email: 'a@b.com', password: 'longenough1', name: 'X', tenantName: 'Acme' }),
    );

    const cookies = res.headers.get('set-cookie') ?? '';
    expect(cookies).toContain(`${SESSION_COOKIE}=raw-token`);
    expect(cookies).toContain('ftth_csrf=');
    // The session row must hold the hash, never the raw token.
    const stored = mocks.prisma.session.create.mock.calls[0][0].data;
    expect(stored.tokenHash).toBe('sha256:raw-token');
    expect(JSON.stringify(stored)).not.toContain('"raw-token"');
  });

  it('reports a database failure as a generic 500 without leaking detail', async () => {
    mocks.prisma.$transaction.mockRejectedValue(new Error('relation "tenant" does not exist'));

    const res = await handleSignup(
      post({ email: 'a@b.com', password: 'longenough1', name: 'X', tenantName: 'Acme' }),
    );

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Signup failed');
    expect(JSON.stringify(body)).not.toMatch(/postgres|relation/i);
  });
});

describe('handleLogin', () => {
  it('rejects malformed input before touching the database', async () => {
    const res = await handleLogin(post('{not json'));
    expect(res.status).toBe(400);
    expect(mocks.prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('rate-limits brute force with a retry-after header', async () => {
    mocks.checkAuthQuota.mockResolvedValue({ allowed: false, retryAfter: 300 });

    const res = await handleLogin(post({ email: 'a@b.com', password: 'whatever1' }));

    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('300');
    expect(mocks.verifyPassword).not.toHaveBeenCalled();
  });

  it('returns the same 401 for an unknown email and a wrong password', async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(null);
    const unknown = await handleLogin(post({ email: 'ghost@example.com', password: 'whatever1' }));

    mocks.prisma.user.findUnique.mockResolvedValue(dbUser());
    mocks.verifyPassword.mockResolvedValue(false);
    const wrong = await handleLogin(post({ email: 'user@example.com', password: 'whatever1' }));

    // Identical status and body: the response must not reveal whether the
    // account exists, or it becomes an enumeration oracle.
    expect(unknown.status).toBe(wrong.status);
    expect(await unknown.json()).toEqual(await wrong.json());
  });

  it('records the failure against every rate-limit key', async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(null);
    mocks.authRateLimitKeys.mockReturnValue(['auth:ip:1.1.1.1', 'auth:email:a@b.com']);

    await handleLogin(post({ email: 'ghost@example.com', password: 'whatever1' }));

    expect(mocks.recordAuthAttempt).toHaveBeenCalledTimes(2);
  });

  it('audits a failed login', async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(null);

    await handleLogin(post({ email: 'ghost@example.com', password: 'whatever1' }));

    expect(mocks.auditLogin).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'unknown', actorId: 'unknown' }),
      'ghost@example.com',
      false,
    );
  });

  it('issues a session and both cookies on success', async () => {
    const res = await handleLogin(post({ email: 'user@example.com', password: 'correct-horse' }));

    expect(res.status).toBe(200);
    const cookies = res.headers.get('set-cookie') ?? '';
    expect(cookies).toContain(`${SESSION_COOKIE}=raw-token`);
    expect(cookies).toContain('ftth_csrf=');
    const body = await res.json();
    expect(body.user.email).toBe('user@example.com');
    expect(body).not.toHaveProperty('tokenHash');
  });

  describe('multi-factor', () => {
    beforeEach(() => {
      mocks.prisma.user.findUnique.mockResolvedValue(
        dbUser({ mfaEnabled: true, totpSecret: 'encrypted' }),
      );
    });

    it('returns mfaRequired with a scoped token when no code is supplied', async () => {
      mocks.issueToken.mockReturnValue({
        token: 'temp',
        tokenHash: 'sha256:temp',
        expiresAt: new Date(Date.now() + 60_000),
      });

      const res = await handleLogin(post({ email: 'user@example.com', password: 'correct-horse' }));
      const body = await res.json();

      expect(body.mfaRequired).toBe(true);
      expect(body.tempToken).toBe('temp');
      // No session cookie before MFA is satisfied.
      expect(res.headers.get('set-cookie') ?? '').not.toContain(SESSION_COOKIE);
      expect(mocks.prisma.session.create).not.toHaveBeenCalled();
    });

    it('rejects a wrong code without creating a session', async () => {
      const res = await handleLogin(
        post({ email: 'user@example.com', password: 'correct-horse', code: '000000' }),
      );

      expect(res.status).toBe(401);
      await expect(res.json()).resolves.toMatchObject({ error: 'Invalid MFA code' });
      expect(mocks.prisma.session.create).not.toHaveBeenCalled();
    });

    it('completes login when the submitted code is correct', async () => {
      // Regression: the handler re-read req.json() after already consuming the
      // body, which threw "Body is unusable". The catch turned it into an empty
      // object, so the code was never seen and MFA login could never finish.
      const totp = await import('@/lib/auth/totp');
      const code = totp.totp('JBSWY3DPEHPK3PXP');

      const res = await handleLogin(
        post({ email: 'user@example.com', password: 'correct-horse', code }),
      );

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toMatchObject({
        user: { email: 'user@example.com' },
      });
      expect(res.headers.get('set-cookie') ?? '').toContain(SESSION_COOKIE);
      expect(mocks.prisma.session.create).toHaveBeenCalled();
    });
  });
});

describe('handleLogout', () => {
  it('deletes the session row keyed by the token hash', async () => {
    const res = await handleLogout(
      new Request('http://localhost/api/auth/logout', {
        method: 'POST',
        headers: { cookie: `${SESSION_COOKIE}=raw-token` },
      }),
    );

    expect(res.status).toBe(200);
    expect(mocks.prisma.session.deleteMany).toHaveBeenCalledWith({
      where: { tokenHash: 'sha256:raw-token' },
    });
  });

  it('expires both cookies and keeps the session cookie HttpOnly', async () => {
    const res = await handleLogout(
      new Request('http://localhost/api/auth/logout', { method: 'POST' }),
    );

    const cookies = res.headers.get('set-cookie') ?? '';
    expect(cookies).toContain(`${SESSION_COOKIE}=`);
    expect(cookies).toContain('Max-Age=0');
    expect(cookies).toMatch(/ftth_session=[^;]*;[^,]*HttpOnly/);
    expect(cookies).toContain('ftth_csrf=');
  });

  it('succeeds without a cookie and still clears both', async () => {
    const res = await handleLogout(
      new Request('http://localhost/api/auth/logout', { method: 'POST' }),
    );

    expect(res.status).toBe(200);
    expect(mocks.prisma.session.deleteMany).not.toHaveBeenCalled();
  });
});

describe('session resolution', () => {
  const sessionUser = {
    id: 'usr-1',
    email: 'user@example.com',
    name: 'User',
    role: 'OWNER',
    tenantId: 'ten-1',
    mfaEnabled: false,
    tenant: { id: 'ten-1', name: 'Acme', slug: 'acme-x' },
  };

  function activeSession(overrides: Record<string, unknown> = {}) {
    return {
      userId: 'usr-1',
      expiresAt: new Date(Date.now() + 3600_000),
      user: sessionUser,
      ...overrides,
    };
  }

  beforeEach(() => {
    mocks.verifyToken.mockReturnValue({ sub: 'usr-1', tenantId: 'ten-1', role: 'OWNER' });
    mocks.prisma.session.findUnique.mockResolvedValue(activeSession());
  });

  it('resolves the current user from the cookie', async () => {
    mocks.cookieJar.set(SESSION_COOKIE, 'raw-token');

    const user = await getCurrentUser();

    expect(user?.email).toBe('user@example.com');
    expect(mocks.prisma.session.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tokenHash: 'sha256:raw-token' } }),
    );
  });

  it('returns null without a cookie', async () => {
    expect(await getCurrentUser()).toBeNull();
    expect(mocks.prisma.session.findUnique).not.toHaveBeenCalled();
  });

  it('returns null for a token that fails verification', async () => {
    mocks.cookieJar.set(SESSION_COOKIE, 'forged');
    mocks.verifyToken.mockReturnValue(null);

    expect(await getCurrentUser()).toBeNull();
  });

  it('returns null for an expired session', async () => {
    mocks.cookieJar.set(SESSION_COOKIE, 'raw-token');
    mocks.prisma.session.findUnique.mockResolvedValue(
      activeSession({ expiresAt: new Date(Date.now() - 1000) }),
    );

    expect(await getCurrentUser()).toBeNull();
  });

  it('refuses a session whose subject no longer matches the token', async () => {
    // A valid signature is not enough: the row on the server has to agree.
    mocks.cookieJar.set(SESSION_COOKIE, 'raw-token');
    mocks.prisma.session.findUnique.mockResolvedValue(activeSession({ userId: 'usr-other' }));

    expect(await getCurrentUser()).toBeNull();
  });

  it('refuses a session whose tenant no longer matches the token', async () => {
    mocks.cookieJar.set(SESSION_COOKIE, 'raw-token');
    mocks.prisma.session.findUnique.mockResolvedValue(
      activeSession({
        user: { ...sessionUser, tenantId: 'ten-other' },
      }),
    );

    expect(await getCurrentUser()).toBeNull();
  });

  it('reports no user through handleMe when unauthenticated', async () => {
    const res = await handleMe(new Request('http://localhost/api/auth/me'));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ user: null });
  });

  it('reports the tenant through handleMe when authenticated', async () => {
    const res = await handleMe(
      new Request('http://localhost/api/auth/me', {
        headers: { cookie: `${SESSION_COOKIE}=raw-token` },
      }),
    );

    const body = await res.json();
    expect(body.user.tenant.slug).toBe('acme-x');
  });
});