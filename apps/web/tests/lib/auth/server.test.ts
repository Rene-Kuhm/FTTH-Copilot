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
  reserveAuthQuota: vi.fn(),
  releaseAuthQuota: vi.fn(),
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
  reserveAuthQuota: mocks.reserveAuthQuota,
  releaseAuthQuota: mocks.releaseAuthQuota,
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
const { AUTH_QUOTA_ERROR_MESSAGE } = await import('@/lib/auth/quota');

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
  mocks.reserveAuthQuota.mockResolvedValue({
    allowed: true,
    retryAfter: 0,
    windowStart: new Date(1_700_000_000_000),
    counts: {},
  });
  mocks.releaseAuthQuota.mockResolvedValue(undefined);
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
    mocks.reserveAuthQuota.mockResolvedValue({
      allowed: false,
      retryAfter: 120,
      windowStart: new Date(1_700_000_000_000),
    });

    const res = await handleSignup(
      post({ email: 'a@b.com', password: 'longenough1', name: 'X', tenantName: 'Acme' }),
    );

    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('120');
    // The account must not be created when the quota is exhausted.
    expect(mocks.prisma.user.create).not.toHaveBeenCalled();
    expect(mocks.releaseAuthQuota).not.toHaveBeenCalled();
  });

  it('creates the tenant and an OWNER user, consumes the quota without refunding, and returns 201', async () => {
    const res = await handleSignup(
      post({ email: 'a@b.com', password: 'longenough1', name: 'X', tenantName: 'Acme' }),
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.user.role).toBe('OWNER');
    expect(body.tenant.id).toBe('ten-1');
    // The password hash must never leave the server.
    expect(JSON.stringify(body)).not.toMatch(/hashed|password/i);
    expect(mocks.reserveAuthQuota).toHaveBeenCalledWith(
      ['signup:ip:203.0.113.9'],
      expect.any(Object),
    );
    expect(mocks.releaseAuthQuota).not.toHaveBeenCalled();
  });

  it('consumes signup:ip quota on successful signups and atomically blocks the 4th attempt when AUTH_RATE_LIMIT_MAX=3', async () => {
    const prevMax = process.env['AUTH_RATE_LIMIT_MAX'];
    const prevWindowMs = process.env['AUTH_RATE_LIMIT_WINDOW_MS'];
    process.env['AUTH_RATE_LIMIT_MAX'] = '3';
    process.env['AUTH_RATE_LIMIT_WINDOW_MS'] = '60000';

    const frozenNowMs = 1_700_000_000_000;
    const startMs = Math.floor(frozenNowMs / 60000) * 60000;
    const buckets = new Map<string, number>();

    mocks.extractClientIp.mockImplementation(
      (xForwardedFor: string | null | undefined): string | null => {
        if (!xForwardedFor) return null;
        const first = xForwardedFor.split(',')[0]?.trim();
        return first && first.length > 0 ? first : null;
      },
    );
    mocks.reserveAuthQuota.mockImplementation(
      async (keys: string[], opts: { max: number; windowMs: number }) => {
        const uniqueKeys = [...new Set(keys)];
        if (uniqueKeys.some((k) => (buckets.get(`${k}:${startMs}`) ?? 0) >= opts.max)) {
          return { allowed: false, retryAfter: 60, windowStart: new Date(startMs), counts: {} };
        }
        const counts: Record<string, number> = {};
        uniqueKeys.forEach((key) => {
          const bucketKey = `${key}:${startMs}`;
          const next = (buckets.get(bucketKey) ?? 0) + 1;
          buckets.set(bucketKey, next);
          counts[key] = next;
        });
        return { allowed: true, retryAfter: 0, windowStart: new Date(startMs), counts };
      },
    );
    mocks.releaseAuthQuota.mockImplementation(async (keys: string[], _o?: unknown, _s?: unknown, _w?: Date, expected: Record<string, number> = {}) => {
      for (const key of keys) {
        const bucketKey = `${key}:${startMs}`;
        const current = buckets.get(bucketKey) ?? 0;
        if (current === expected[key]) buckets.set(bucketKey, Math.max(current - 1, 0));
      }
    });

    try {
      const first = await handleSignup(
        post(
          { email: 'first@b.com', password: 'longenough1', name: 'X', tenantName: 'Acme 1' },
          { 'x-forwarded-for': '198.51.100.7' },
        ),
      );
      expect(first.status).toBe(201);
      expect(buckets.get(`signup:ip:198.51.100.7:${startMs}`)).toBe(1);
      expect(mocks.releaseAuthQuota).not.toHaveBeenCalled();

      for (let i = 2; i <= 3; i++) {
        const ok = await handleSignup(
          post(
            { email: `u${i}@b.com`, password: 'longenough1', name: 'X', tenantName: `Acme ${i}` },
            { 'x-forwarded-for': '198.51.100.7' },
          ),
        );
        expect(ok.status).toBe(201);
      }
      expect(buckets.get(`signup:ip:198.51.100.7:${startMs}`)).toBe(3);

      mocks.prisma.user.create.mockClear();
      mocks.prisma.tenant.create.mockClear();

      const fourthSequential = await handleSignup(
        post(
          { email: 'u4@b.com', password: 'longenough1', name: 'X', tenantName: 'Acme 4' },
          { 'x-forwarded-for': '198.51.100.7' },
        ),
      );
      expect(fourthSequential.status).toBe(429);
      expect(fourthSequential.headers.get('retry-after')).toBe('60');
      expect(buckets.get(`signup:ip:198.51.100.7:${startMs}`)).toBe(3);
      expect(mocks.prisma.user.create).not.toHaveBeenCalled();
      expect(mocks.prisma.tenant.create).not.toHaveBeenCalled();

      // Atomic gate under concurrent signups from a fresh IP
      const concurrentResults = await Promise.all(
        [1, 2, 3, 4].map((i) =>
          handleSignup(
            post(
              { email: `c${i}@b.com`, password: 'longenough1', name: 'X', tenantName: `Conc ${i}` },
              { 'x-forwarded-for': '198.51.100.8' },
            ),
          ),
        ),
      );
      const statuses = concurrentResults.map((r) => r.status).sort((a, b) => a - b);
      expect(statuses).toEqual([201, 201, 201, 429]);
      expect(mocks.prisma.user.create).toHaveBeenCalledTimes(3);
      expect(mocks.releaseAuthQuota).not.toHaveBeenCalled();
    } finally {
      if (prevMax === undefined) delete process.env['AUTH_RATE_LIMIT_MAX'];
      else process.env['AUTH_RATE_LIMIT_MAX'] = prevMax;

      if (prevWindowMs === undefined) delete process.env['AUTH_RATE_LIMIT_WINDOW_MS'];
      else process.env['AUTH_RATE_LIMIT_WINDOW_MS'] = prevWindowMs;
    }
  });

  it('stores a session and sets the session and CSRF cookies', async () => {
    const res = await handleSignup(
      post({ email: 'a@b.com', password: 'longenough1', name: 'X', tenantName: 'Acme' }),
    );

    const setCookies = res.headers.getSetCookie();
    expect(setCookies).toHaveLength(2);
    for (const entry of setCookies) {
      expect(entry.includes(`${SESSION_COOKIE}=`) && entry.includes('ftth_csrf=')).toBe(false);
    }
    expect(setCookies.some((entry) => entry.includes(`${SESSION_COOKIE}=raw-token`))).toBe(true);
    expect(setCookies.some((entry) => entry.includes('ftth_csrf='))).toBe(true);
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
    mocks.reserveAuthQuota.mockResolvedValue({
      allowed: false,
      retryAfter: 300,
      windowStart: new Date(1_700_000_000_000),
    });

    const res = await handleLogin(post({ email: 'a@b.com', password: 'whatever1' }));

    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('300');
    await expect(res.json()).resolves.toEqual({ error: AUTH_QUOTA_ERROR_MESSAGE });
    expect(mocks.verifyPassword).not.toHaveBeenCalled();
    expect(mocks.releaseAuthQuota).not.toHaveBeenCalled();
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

  it('reserves against every rate-limit key and does not refund on failure', async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(null);
    mocks.authRateLimitKeys.mockReturnValue(['auth:ip:1.1.1.1', 'auth:email:a@b.com']);

    await handleLogin(post({ email: 'ghost@example.com', password: 'whatever1' }));

    expect(mocks.reserveAuthQuota).toHaveBeenCalledTimes(1);
    expect(mocks.reserveAuthQuota).toHaveBeenCalledWith(
      ['auth:ip:1.1.1.1', 'auth:email:a@b.com'],
      expect.any(Object),
    );
    expect(mocks.releaseAuthQuota).not.toHaveBeenCalled();
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

  it('issues a session and both cookies on success and refunds the reservation', async () => {
    const res = await handleLogin(post({ email: 'user@example.com', password: 'correct-horse' }));

    expect(res.status).toBe(200);
    expect(mocks.releaseAuthQuota).toHaveBeenCalledTimes(1);
    const setCookies = res.headers.getSetCookie();
    expect(setCookies).toHaveLength(2);
    for (const entry of setCookies) {
      expect(entry.includes(`${SESSION_COOKIE}=`) && entry.includes('ftth_csrf=')).toBe(false);
    }
    expect(setCookies.some((entry) => entry.includes(`${SESSION_COOKIE}=raw-token`))).toBe(true);
    expect(setCookies.some((entry) => entry.includes('ftth_csrf='))).toBe(true);
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

    it('returns mfaRequired with a scoped token when no code is supplied and refunds quota', async () => {
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
      expect(mocks.releaseAuthQuota).toHaveBeenCalledTimes(1);
    });

    it('rejects a wrong code without creating a session or refunding quota', async () => {
      const res = await handleLogin(
        post({ email: 'user@example.com', password: 'correct-horse', code: '000000' }),
      );

      expect(res.status).toBe(401);
      await expect(res.json()).resolves.toMatchObject({ error: 'Invalid MFA code' });
      expect(mocks.prisma.session.create).not.toHaveBeenCalled();
      expect(mocks.releaseAuthQuota).not.toHaveBeenCalled();
    });

    it('completes login when the submitted code is correct and refunds quota', async () => {
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
      expect(mocks.releaseAuthQuota).toHaveBeenCalledTimes(1);
    });

    it('consumes failure quota on invalid inline MFA codes without penalizing valid codes', async () => {
      const prevMax = process.env['AUTH_RATE_LIMIT_MAX'];
      const prevWindowMs = process.env['AUTH_RATE_LIMIT_WINDOW_MS'];
      process.env['AUTH_RATE_LIMIT_MAX'] = '3';
      process.env['AUTH_RATE_LIMIT_WINDOW_MS'] = '60000';

      interface QuotaBucket {
        count: number;
        expiresAt: number;
      }
      const frozenNowMs = 1_700_000_000_000;
      const buckets = new Map<string, QuotaBucket>();
      const windowStart = (nowMs: number, windowMs: number) =>
        Math.floor(nowMs / windowMs) * windowMs;
      const retryAfter = (nowMs: number, startMs: number, windowMs: number) =>
        Math.max(1, Math.ceil((startMs + windowMs - nowMs) / 1000));

      mocks.extractClientIp.mockImplementation(
        (xForwardedFor: string | null | undefined): string | null => {
          if (!xForwardedFor) return null;
          const first = xForwardedFor.split(',')[0]?.trim();
          return first && first.length > 0 ? first : null;
        },
      );
      mocks.authRateLimitKeys.mockImplementation((email: string, ip: string | null): string[] => {
        const keys = [`login:email:${email.trim().toLowerCase()}`];
        if (ip) keys.push(`login:ip:${ip}`);
        return keys;
      });
      mocks.reserveAuthQuota.mockImplementation(
        async (keys: string[], opts: { max: number; windowMs: number }) => {
          const nowMs = frozenNowMs;
          const startMs = windowStart(nowMs, opts.windowMs);
          const uniqueKeys = [...new Set(keys)];
          if (uniqueKeys.some((k) => {
            const b = buckets.get(`${k}:${startMs}`);
            return (b && b.expiresAt > nowMs ? b.count : 0) >= opts.max;
          })) {
            return {
              allowed: false,
              retryAfter: retryAfter(nowMs, startMs, opts.windowMs),
              windowStart: new Date(startMs),
              counts: {},
            };
          }
          const counts: Record<string, number> = {};
          uniqueKeys.forEach((key) => {
            const bucketKey = `${key}:${startMs}`;
            const existing = buckets.get(bucketKey);
            const count = existing && existing.expiresAt > nowMs ? existing.count + 1 : 1;
            buckets.set(bucketKey, { count, expiresAt: startMs + opts.windowMs });
            counts[key] = count;
          });
          return { allowed: true, retryAfter: 0, windowStart: new Date(startMs), counts };
        },
      );
      mocks.releaseAuthQuota.mockImplementation(
        async (
          keys: string[],
          opts: { max: number; windowMs: number },
          _store?: unknown,
          startDate?: Date,
          expected: Record<string, number> = {},
        ) => {
          const startMs = startDate ? startDate.getTime() : windowStart(frozenNowMs, opts.windowMs);
          for (const key of keys) {
            const bucketKey = `${key}:${startMs}`;
            const existing = buckets.get(bucketKey);
            if (existing && existing.count === expected[key]) {
              buckets.set(bucketKey, {
                count: Math.max(existing.count - 1, 0),
                expiresAt: existing.expiresAt,
              });
            }
          }
        },
      );

      try {
        const totp = await import('@/lib/auth/totp');
        const validCode = totp.totp('JBSWY3DPEHPK3PXP');
        let invalidCode = String((Number(validCode) + 1) % 1_000_000).padStart(6, '0');
        while (invalidCode === validCode || totp.verifyTOTP('JBSWY3DPEHPK3PXP', invalidCode)) {
          invalidCode = String((Number(invalidCode) + 1) % 1_000_000).padStart(6, '0');
        }

        const okRes = await handleLogin(
          post(
            { email: 'user@example.com', password: 'correct-horse', code: validCode },
            { 'x-forwarded-for': '198.51.100.1' },
          ),
        );
        expect(okRes.status).toBe(200);
        expect(mocks.prisma.session.create).toHaveBeenCalledTimes(1);
        for (const bucket of buckets.values()) {
          expect(bucket.count).toBe(0);
        }

        mocks.prisma.session.create.mockClear();

        for (let i = 1; i <= 3; i++) {
          const badRes = await handleLogin(
            post(
              { email: 'user@example.com', password: 'correct-horse', code: invalidCode },
              { 'x-forwarded-for': `198.51.100.${10 + i}` },
            ),
          );
          expect(badRes.status).toBe(401);
          await expect(badRes.json()).resolves.toEqual({ error: 'Invalid MFA code' });
        }

        const throttled = await handleLogin(
          post(
            { email: 'user@example.com', password: 'correct-horse', code: validCode },
            { 'x-forwarded-for': '198.51.100.99' },
          ),
        );
        expect(throttled.status).toBe(429);
        expect(throttled.headers.get('retry-after')).toMatch(/^[1-9]\d*$/);
        await expect(throttled.json()).resolves.toEqual({ error: AUTH_QUOTA_ERROR_MESSAGE });
        expect(mocks.prisma.session.create).not.toHaveBeenCalled();
      } finally {
        if (prevMax === undefined) delete process.env['AUTH_RATE_LIMIT_MAX'];
        else process.env['AUTH_RATE_LIMIT_MAX'] = prevMax;

        if (prevWindowMs === undefined) delete process.env['AUTH_RATE_LIMIT_WINDOW_MS'];
        else process.env['AUTH_RATE_LIMIT_WINDOW_MS'] = prevWindowMs;
      }
    });

    it('uses the login namespace and is not blocked by exhausted mfa buckets', async () => {
      const prevMax = process.env['AUTH_RATE_LIMIT_MAX'];
      const prevWindowMs = process.env['AUTH_RATE_LIMIT_WINDOW_MS'];
      process.env['AUTH_RATE_LIMIT_MAX'] = '3';
      process.env['AUTH_RATE_LIMIT_WINDOW_MS'] = '60000';

      const frozenNowMs = 1_700_000_000_000;
      const startMs = Math.floor(frozenNowMs / 60000) * 60000;
      const buckets = new Map<string, number>([
        [`mfa:email:user@example.com:${startMs}`, 3],
        [`mfa:ip:203.0.113.9:${startMs}`, 3],
      ]);

      mocks.prisma.user.findUnique.mockResolvedValue(dbUser({ mfaEnabled: false, totpSecret: null }));
      mocks.authRateLimitKeys.mockImplementation(
        (email: string, ip: string | null, scope: 'login' | 'mfa' = 'login'): string[] => {
          const keys = [`${scope}:email:${email.trim().toLowerCase()}`];
          if (ip) keys.push(`${scope}:ip:${ip}`);
          return keys;
        },
      );
      mocks.reserveAuthQuota.mockImplementation(async (keys: string[], opts: { max: number; windowMs: number }) => {
        const uniqueKeys = [...new Set(keys)];
        if (uniqueKeys.some((k) => (buckets.get(`${k}:${startMs}`) ?? 0) >= opts.max)) {
          return { allowed: false, retryAfter: 60, windowStart: new Date(startMs), counts: {} };
        }
        const counts: Record<string, number> = {};
        uniqueKeys.forEach((key) => {
          const bucketKey = `${key}:${startMs}`;
          const next = (buckets.get(bucketKey) ?? 0) + 1;
          buckets.set(bucketKey, next);
          counts[key] = next;
        });
        return { allowed: true, retryAfter: 0, windowStart: new Date(startMs), counts };
      });
      mocks.releaseAuthQuota.mockImplementation(async (keys: string[], _o?: unknown, _s?: unknown, _w?: Date, expected: Record<string, number> = {}) => {
        for (const key of keys) {
          const bucketKey = `${key}:${startMs}`;
          const current = buckets.get(bucketKey) ?? 0;
          if (current === expected[key]) buckets.set(bucketKey, Math.max(current - 1, 0));
        }
      });

      try {
        const res = await handleLogin(
          post({ email: 'user@example.com', password: 'correct-horse' }, { 'x-forwarded-for': '203.0.113.9' }),
        );
        expect(res.status).toBe(200);
        expect(mocks.authRateLimitKeys).toHaveBeenCalledWith('user@example.com', '203.0.113.9');
        expect(buckets.get(`mfa:email:user@example.com:${startMs}`)).toBe(3);
        expect(buckets.get(`mfa:ip:203.0.113.9:${startMs}`)).toBe(3);
        expect(buckets.get(`login:email:user@example.com:${startMs}`)).toBe(0);
      } finally {
        if (prevMax === undefined) delete process.env['AUTH_RATE_LIMIT_MAX'];
        else process.env['AUTH_RATE_LIMIT_MAX'] = prevMax;

        if (prevWindowMs === undefined) delete process.env['AUTH_RATE_LIMIT_WINDOW_MS'];
        else process.env['AUTH_RATE_LIMIT_WINDOW_MS'] = prevWindowMs;
      }
    });
  });

  describe('quota-store outage degradation', () => {
    it('returns 401 Invalid credentials for wrong password when quota store fails', async () => {
      mocks.reserveAuthQuota.mockRejectedValue(new Error('DB down'));
      mocks.verifyPassword.mockResolvedValue(false);
      const res = await handleLogin(post({ email: 'user@example.com', password: 'wrong-password' }));
      expect(res.status).toBe(401);
      await expect(res.json()).resolves.toEqual({ error: 'Invalid credentials' });
    });

    it('returns 401 Invalid MFA code for wrong TOTP code when quota store fails', async () => {
      mocks.reserveAuthQuota.mockRejectedValue(new Error('DB down'));
      mocks.prisma.user.findUnique.mockResolvedValue(dbUser({ mfaEnabled: true, totpSecret: 'encrypted' }));
      const res = await handleLogin(post({ email: 'user@example.com', password: 'correct-horse', code: '000000' }));
      expect(res.status).toBe(401);
      await expect(res.json()).resolves.toEqual({ error: 'Invalid MFA code' });
    });

    it('returns 200 for valid credentials when quota store fails on reserve or release', async () => {
      mocks.reserveAuthQuota.mockRejectedValueOnce(new Error('DB down'));
      const resReserveFail = await handleLogin(post({ email: 'user@example.com', password: 'correct-horse' }));
      expect(resReserveFail.status).toBe(200);
      expect(mocks.releaseAuthQuota).not.toHaveBeenCalled();

      mocks.releaseAuthQuota.mockRejectedValueOnce(new Error('DB down'));
      const resReleaseFail = await handleLogin(post({ email: 'user@example.com', password: 'correct-horse' }));
      expect(resReleaseFail.status).toBe(200);
      expect(mocks.prisma.session.create).toHaveBeenCalledTimes(2);
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

    const setCookies = res.headers.getSetCookie();
    expect(setCookies).toHaveLength(2);
    for (const entry of setCookies) {
      expect(entry.includes(`${SESSION_COOKIE}=`) && entry.includes('ftth_csrf=')).toBe(false);
    }
    const sessionClear = setCookies.find((entry) => entry.startsWith(`${SESSION_COOKIE}=`));
    const csrfClear = setCookies.find((entry) => entry.startsWith('ftth_csrf='));
    expect(sessionClear).toBeDefined();
    expect(sessionClear).toContain('Max-Age=0');
    expect(sessionClear).toContain('HttpOnly');
    expect(csrfClear).toBeDefined();
    expect(csrfClear).toContain('Max-Age=0');
  });

  it('succeeds without a cookie and still clears both', async () => {
    const res = await handleLogout(
      new Request('http://localhost/api/auth/logout', { method: 'POST' }),
    );

    expect(res.status).toBe(200);
    expect(mocks.prisma.session.deleteMany).not.toHaveBeenCalled();
    const setCookies = res.headers.getSetCookie();
    expect(setCookies).toHaveLength(2);
    expect(setCookies.some((entry) => entry.startsWith(`${SESSION_COOKIE}=`) && entry.includes('Max-Age=0'))).toBe(true);
    expect(setCookies.some((entry) => entry.startsWith('ftth_csrf=') && entry.includes('Max-Age=0'))).toBe(true);
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