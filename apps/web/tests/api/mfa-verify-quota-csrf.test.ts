import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { validateCsrfToken } from '@/lib/auth/csrf';

interface Bucket {
  count: number;
  expiresAt: number;
}

const EXPECTED_QUOTA_ERROR = 'Demasiados intentos. Probá de nuevo más tarde.';

const mocks = vi.hoisted(() => {
  const buckets = new Map<string, Bucket>();

  return {
    buckets,
    usedTempKeys: new Set<string>(),
    failCounts: new Map<string, number>(),
    prisma: {
      user: { findUnique: vi.fn(), update: vi.fn() },
      session: { create: vi.fn() },
      authRateLimit: { create: vi.fn(), findUnique: vi.fn(), upsert: vi.fn() },
    },
    verifyPassword: vi.fn(),
    issueToken: vi.fn(),
    verifyToken: vi.fn(),
    hashToken: vi.fn((t: string) => `sha256:${t}`),
    decryptApiKey: vi.fn(),
    sessionCookieAttributes: vi.fn(),
    verifyTOTP: vi.fn(),
    auditLogin: vi.fn(),
    getCurrentUser: vi.fn(),
    reserveError: null as Error | null,
    releaseError: null as Error | null,
  };
});

function computeWindowStartMs(nowMs: number, windowMs: number): number {
  return Math.floor(nowMs / windowMs) * windowMs;
}

function retryAfterSeconds(nowMs: number, windowStartMs: number, windowMs: number): number {
  return Math.max(1, Math.ceil((windowStartMs + windowMs - nowMs) / 1000));
}

const FROZEN_NOW_MS = 1_700_000_000_000;

vi.mock('@ftth-copilot/db', () => ({
  prisma: mocks.prisma,
  verifyPassword: mocks.verifyPassword,
  issueToken: mocks.issueToken,
  verifyToken: mocks.verifyToken,
  hashToken: mocks.hashToken,
  decryptApiKey: mocks.decryptApiKey,
  COOKIE_NAME: 'ftth_session',
  TOKEN_TTL_SECONDS: 3600,
  sessionCookieAttributes: mocks.sessionCookieAttributes,
  extractClientIp: (xForwardedFor: string | null | undefined): string | null => {
    if (!xForwardedFor) return null;
    const first = xForwardedFor.split(',')[0]?.trim();
    return first && first.length > 0 ? first : null;
  },
  authRateLimitKeys: (email: string, ip: string | null, scope: 'login' | 'mfa' = 'login'): string[] => {
    const keys = [`${scope}:email:${email.trim().toLowerCase()}`];
    if (ip) keys.push(`${scope}:ip:${ip}`);
    return keys;
  },
  checkAuthQuota: async (
    key: string,
    opts: { max: number; windowMs: number },
  ): Promise<{ allowed: boolean; retryAfter: number }> => {
    const nowMs = FROZEN_NOW_MS;
    const windowStartMs = computeWindowStartMs(nowMs, opts.windowMs);
    const bucketKey = `${key}:${windowStartMs}`;
    const bucket = mocks.buckets.get(bucketKey);
    const count = bucket && bucket.expiresAt > nowMs ? bucket.count : 0;
    if (count < opts.max) {
      return { allowed: true, retryAfter: 0 };
    }
    return {
      allowed: false,
      retryAfter: retryAfterSeconds(nowMs, windowStartMs, opts.windowMs),
    };
  },
  recordAuthAttempt: async (
    key: string,
    opts: { max: number; windowMs: number },
  ): Promise<{ allowed: boolean; retryAfter: number }> => {
    const nowMs = FROZEN_NOW_MS;
    const windowStartMs = computeWindowStartMs(nowMs, opts.windowMs);
    const expiresAt = windowStartMs + opts.windowMs;
    const bucketKey = `${key}:${windowStartMs}`;
    const existing = mocks.buckets.get(bucketKey);
    const count = existing && existing.expiresAt > nowMs ? existing.count + 1 : 1;
    mocks.buckets.set(bucketKey, { count, expiresAt });
    if (count <= opts.max) {
      return { allowed: true, retryAfter: 0 };
    }
    return {
      allowed: false,
      retryAfter: retryAfterSeconds(nowMs, windowStartMs, opts.windowMs),
    };
  },
  reserveAuthQuota: async (
    keys: string[],
    opts: { max: number; windowMs: number },
  ): Promise<{ allowed: boolean; retryAfter: number; windowStart: Date }> => {
    if (mocks.reserveError) throw mocks.reserveError;
    const nowMs = FROZEN_NOW_MS;
    const windowStartMs = computeWindowStartMs(nowMs, opts.windowMs);
    const expiresAt = windowStartMs + opts.windowMs;
    const uniqueKeys = [...new Set(keys)];
    if (uniqueKeys.some((k) => {
      const b = mocks.buckets.get(`${k}:${windowStartMs}`);
      return (b && b.expiresAt > nowMs ? b.count : 0) >= opts.max;
    })) {
      return {
        allowed: false,
        retryAfter: retryAfterSeconds(nowMs, windowStartMs, opts.windowMs),
        windowStart: new Date(windowStartMs),
      };
    }
    uniqueKeys.forEach((key) => {
      const bucketKey = `${key}:${windowStartMs}`;
      const existing = mocks.buckets.get(bucketKey);
      const count = existing && existing.expiresAt > nowMs ? existing.count + 1 : 1;
      mocks.buckets.set(bucketKey, { count, expiresAt });
    });
    return { allowed: true, retryAfter: 0, windowStart: new Date(windowStartMs) };
  },
  releaseAuthQuota: async (
    keys: string[],
    opts: { max: number; windowMs: number },
    _store?: unknown,
    windowStartDate?: Date,
  ): Promise<void> => {
    if (mocks.releaseError) throw mocks.releaseError;
    const windowStartMs = windowStartDate
      ? windowStartDate.getTime()
      : computeWindowStartMs(FROZEN_NOW_MS, opts.windowMs);
    for (const key of new Set(keys)) {
      const bucketKey = `${key}:${windowStartMs}`;
      const existing = mocks.buckets.get(bucketKey);
      if (existing) {
        mocks.buckets.set(bucketKey, {
          count: Math.max(existing.count - 1, 0),
          expiresAt: existing.expiresAt,
        });
      }
    }
  },
}));

vi.mock('@/lib/auth/totp', () => ({
  verifyTOTP: mocks.verifyTOTP,
}));

vi.mock('@ftth-copilot/soc', () => ({
  auditAuth: { login: mocks.auditLogin },
}));

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));

vi.mock('@/lib/auth/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/server')>()),
  getCurrentUser: mocks.getCurrentUser,
}));

const { POST } = await import('@/app/api/auth/mfa/verify/route');
const { POST: loginPost } = await import('@/app/api/auth/login/route');

function mfaRequest(body: unknown, ip?: string): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (ip) {
    headers['x-forwarded-for'] = ip;
  }
  return new NextRequest('http://localhost/api/auth/mfa/verify', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'usr-1',
    email: 'operator@example.com',
    name: 'Operator',
    role: 'OWNER',
    tenantId: 'ten-1',
    passwordHash: 'hashed-password',
    mfaEnabled: true,
    totpSecret: 'encrypted-secret',
    ...overrides,
  };
}

function extractCookieValue(setCookieHeaders: string[], cookieName: string): string | null {
  const prefix = `${cookieName}=`;
  const entry = setCookieHeaders.find((header) => header.startsWith(prefix));
  if (!entry) return null;
  const semiIndex = entry.indexOf(';');
  const value = semiIndex === -1 ? entry.slice(prefix.length) : entry.slice(prefix.length, semiIndex);
  return value.length > 0 ? value : null;
}

describe('POST /api/auth/mfa/verify — brute-force quota and CSRF cookie', () => {
  let prevMax: string | undefined;
  let prevWindowMs: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.buckets.clear();
    mocks.usedTempKeys.clear();
    mocks.failCounts.clear();

    prevMax = process.env['AUTH_RATE_LIMIT_MAX'];
    prevWindowMs = process.env['AUTH_RATE_LIMIT_WINDOW_MS'];
    process.env['AUTH_RATE_LIMIT_MAX'] = '3';
    process.env['AUTH_RATE_LIMIT_WINDOW_MS'] = '60000';

    mocks.sessionCookieAttributes.mockReturnValue({
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: false,
      maxAge: 3600,
    });
    mocks.issueToken.mockReturnValue({
      token: 'raw-session-token',
      tokenHash: 'sha256:raw-session-token',
      expiresAt: new Date(Date.now() + 3600_000),
    });
    mocks.verifyToken.mockReturnValue({
      sub: 'usr-1',
      tenantId: 'ten-1',
      role: 'OWNER',
      isTemp: true,
      exp: Math.floor(Date.now() / 1000) + 300,
    });
    mocks.decryptApiKey.mockReturnValue('JBSWY3DPEHPK3PXP');
    mocks.verifyPassword.mockResolvedValue(true);
    mocks.verifyTOTP.mockReturnValue(true);
    mocks.prisma.user.findUnique.mockResolvedValue(makeUser());
    mocks.prisma.user.update.mockResolvedValue(makeUser({ mfaEnabled: true }));
    mocks.prisma.session.create.mockResolvedValue({});
    mocks.prisma.authRateLimit.findUnique.mockImplementation(
      async ({ where }: { where: { key_windowStart: { key: string } } }) => {
        const key = where.key_windowStart.key;
        return mocks.usedTempKeys.has(key) ? { id: key } : null;
      },
    );
    mocks.prisma.authRateLimit.upsert.mockImplementation(
      async ({ where }: { where: { key_windowStart: { key: string } } }) => {
        const key = where.key_windowStart.key;
        const nextCount = (mocks.failCounts.get(key) ?? 0) + 1;
        mocks.failCounts.set(key, nextCount);
        return { count: nextCount };
      },
    );
    mocks.prisma.authRateLimit.create.mockImplementation(async ({ data }: { data: { key: string } }) => {
      if (mocks.usedTempKeys.has(data.key)) {
        const err = new Error('Unique constraint failed') as Error & { code?: string };
        err.code = 'P2002';
        throw err;
      }
      mocks.usedTempKeys.add(data.key);
      return data;
    });
    mocks.auditLogin.mockResolvedValue(undefined);
    mocks.getCurrentUser.mockResolvedValue(null);
    mocks.reserveError = null;
    mocks.releaseError = null;
  });

  afterEach(() => {
    if (prevMax === undefined) delete process.env['AUTH_RATE_LIMIT_MAX'];
    else process.env['AUTH_RATE_LIMIT_MAX'] = prevMax;

    if (prevWindowMs === undefined) delete process.env['AUTH_RATE_LIMIT_WINDOW_MS'];
    else process.env['AUTH_RATE_LIMIT_WINDOW_MS'] = prevWindowMs;
  });

  describe('handleMfaLogin quota enforcement (S1, S3, S4, S5)', () => {
    it('enforces per-email budget after repeated wrong passwords and rejects before credential check', async () => {
      mocks.verifyPassword.mockResolvedValue(false);

      for (let i = 1; i <= 3; i++) {
        const res = await POST(
          mfaRequest(
            { email: 'operator@example.com', password: 'wrong-password', code: '123456' },
            `198.51.100.${i}`,
          ),
        );
        expect(res.status).toBe(401);
      }

      mocks.prisma.user.findUnique.mockClear();
      mocks.verifyPassword.mockClear();
      mocks.verifyPassword.mockResolvedValue(true);
      mocks.auditLogin.mockClear();

      const throttled = await POST(
        mfaRequest(
          { email: 'Operator@example.com', password: 'correct-password', code: '123456' },
          '198.51.100.99',
        ),
      );

      expect(throttled.status).toBe(429);
      const retryAfter = throttled.headers.get('retry-after');
      expect(retryAfter).toMatch(/^[1-9]\d*$/);
      await expect(throttled.json()).resolves.toEqual({ error: EXPECTED_QUOTA_ERROR });
      expect(mocks.prisma.user.findUnique).not.toHaveBeenCalled();
      expect(mocks.verifyPassword).not.toHaveBeenCalled();
      expect(mocks.prisma.session.create).not.toHaveBeenCalled();
      expect(mocks.auditLogin).not.toHaveBeenCalled();
    });

    it('enforces per-email budget after repeated wrong TOTP codes', async () => {
      mocks.verifyTOTP.mockReturnValue(false);

      for (let i = 1; i <= 3; i++) {
        const res = await POST(
          mfaRequest(
            { email: 'totp-target@example.com', password: 'correct-password', code: '000000' },
            `198.51.100.${10 + i}`,
          ),
        );
        expect(res.status).toBe(401);
        await expect(res.json()).resolves.toEqual({ error: 'Invalid MFA code' });
      }

      mocks.prisma.user.findUnique.mockClear();
      mocks.verifyPassword.mockClear();
      mocks.verifyTOTP.mockReturnValue(true);

      const throttled = await POST(
        mfaRequest(
          { email: 'totp-target@example.com', password: 'correct-password', code: '654321' },
          '198.51.100.50',
        ),
      );

      expect(throttled.status).toBe(429);
      expect(throttled.headers.get('retry-after')).toMatch(/^[1-9]\d*$/);
      await expect(throttled.json()).resolves.toEqual({ error: EXPECTED_QUOTA_ERROR });
      expect(mocks.prisma.user.findUnique).not.toHaveBeenCalled();
      expect(mocks.verifyPassword).not.toHaveBeenCalled();
      expect(mocks.prisma.session.create).not.toHaveBeenCalled();
    });

    it('records failed attempts for unknown emails and throttles subsequent requests', async () => {
      mocks.prisma.user.findUnique.mockResolvedValue(null);

      for (let i = 1; i <= 3; i++) {
        const res = await POST(
          mfaRequest(
            { email: 'ghost@example.com', password: 'any-password', code: '123456' },
            `198.51.100.${20 + i}`,
          ),
        );
        expect(res.status).toBe(401);
      }

      mocks.prisma.user.findUnique.mockClear();

      const throttled = await POST(
        mfaRequest(
          { email: 'ghost@example.com', password: 'any-password', code: '123456' },
          '198.51.100.88',
        ),
      );

      expect(throttled.status).toBe(429);
      expect(throttled.headers.get('retry-after')).toMatch(/^[1-9]\d*$/);
      await expect(throttled.json()).resolves.toEqual({ error: EXPECTED_QUOTA_ERROR });
      expect(mocks.prisma.user.findUnique).not.toHaveBeenCalled();
      expect(mocks.prisma.session.create).not.toHaveBeenCalled();
    });

    it('enforces per-IP budget across different emails from the same client IP', async () => {
      mocks.verifyPassword.mockResolvedValue(false);
      const sharedIp = '203.0.113.50';

      for (let i = 1; i <= 3; i++) {
        const res = await POST(
          mfaRequest(
            { email: `user${i}@example.com`, password: 'wrong-password', code: '123456' },
            sharedIp,
          ),
        );
        expect(res.status).toBe(401);
      }

      mocks.prisma.user.findUnique.mockClear();
      mocks.verifyPassword.mockClear();
      mocks.verifyPassword.mockResolvedValue(true);

      const throttled = await POST(
        mfaRequest(
          { email: 'fresh-user@example.com', password: 'correct-password', code: '123456' },
          sharedIp,
        ),
      );

      expect(throttled.status).toBe(429);
      expect(throttled.headers.get('retry-after')).toMatch(/^[1-9]\d*$/);
      await expect(throttled.json()).resolves.toEqual({ error: EXPECTED_QUOTA_ERROR });
      expect(mocks.prisma.user.findUnique).not.toHaveBeenCalled();
      expect(mocks.verifyPassword).not.toHaveBeenCalled();
      expect(mocks.prisma.session.create).not.toHaveBeenCalled();
    });
  });

  describe('handleMfaContinue quota enforcement (S1, S3, S4, S5)', () => {
    it('enforces quota after repeated wrong TOTP codes on tempToken flow', async () => {
      mocks.verifyTOTP.mockReturnValue(false);

      for (let i = 1; i <= 3; i++) {
        const res = await POST(
          mfaRequest({ tempToken: 'valid-temp-token', code: '000000' }, `198.51.100.${30 + i}`),
        );
        expect(res.status).toBe(401);
        await expect(res.json()).resolves.toEqual({ error: 'Invalid MFA code' });
      }

      mocks.verifyTOTP.mockClear();
      mocks.verifyTOTP.mockReturnValue(true);

      const throttled = await POST(
        mfaRequest({ tempToken: 'valid-temp-token', code: '654321' }, '198.51.100.77'),
      );

      expect(throttled.status).toBe(429);
      expect(throttled.headers.get('retry-after')).toMatch(/^[1-9]\d*$/);
      await expect(throttled.json()).resolves.toEqual({ error: EXPECTED_QUOTA_ERROR });
      expect(mocks.verifyTOTP).not.toHaveBeenCalled();
      expect(mocks.prisma.session.create).not.toHaveBeenCalled();
    });

    it('rejects an invalid tempToken with 401 without recording a fabricated email key', async () => {
      mocks.verifyToken.mockReturnValue(null);

      const res = await POST(
        mfaRequest({ tempToken: 'forged-token', code: '123456' }, '203.0.113.77'),
      );

      expect(res.status).toBe(401);
      await expect(res.json()).resolves.toEqual({ error: 'Invalid or expired temp token' });
      expect(mocks.buckets.size).toBe(0);
    });
  });

  describe('CSRF cookie issuance on successful MFA login (S2, S5)', () => {
    it('sets both ftth_session and a valid ftth_csrf cookie on handleMfaLogin success', async () => {
      const res = await POST(
        mfaRequest(
          { email: 'operator@example.com', password: 'correct-password', code: '654321' },
          '203.0.113.10',
        ),
      );

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({
        user: {
          id: 'usr-1',
          email: 'operator@example.com',
          name: 'Operator',
          role: 'OWNER',
        },
      });

      const setCookies = res.headers.getSetCookie();
      expect(setCookies).toHaveLength(2);
      for (const entry of setCookies) {
        expect(entry.includes('ftth_session=') && entry.includes('ftth_csrf=')).toBe(false);
      }
      expect(setCookies.some((entry) => entry.includes('ftth_session=raw-session-token'))).toBe(true);
      expect(setCookies.some((entry) => entry.includes('ftth_csrf='))).toBe(true);

      const csrfToken = extractCookieValue(setCookies, 'ftth_csrf');
      expect(csrfToken).toBeTruthy();
      expect(validateCsrfToken(`ftth_csrf=${csrfToken}`, csrfToken)).toBe(true);
    });

    it('sets both ftth_session and a valid ftth_csrf cookie on handleMfaContinue success', async () => {
      const res = await POST(
        mfaRequest({ tempToken: 'valid-temp-token', code: '654321' }, '203.0.113.11'),
      );

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({
        user: {
          id: 'usr-1',
          email: 'operator@example.com',
          name: 'Operator',
          role: 'OWNER',
        },
      });

      const setCookies = res.headers.getSetCookie();
      expect(setCookies).toHaveLength(2);
      for (const entry of setCookies) {
        expect(entry.includes('ftth_session=') && entry.includes('ftth_csrf=')).toBe(false);
      }
      expect(setCookies.some((entry) => entry.includes('ftth_session=raw-session-token'))).toBe(true);
      expect(setCookies.some((entry) => entry.includes('ftth_csrf='))).toBe(true);

      const csrfToken = extractCookieValue(setCookies, 'ftth_csrf');
      expect(csrfToken).toBeTruthy();
      expect(validateCsrfToken(`ftth_csrf=${csrfToken}`, csrfToken)).toBe(true);
    });
  });

  describe('handleSetupVerification quota enforcement', () => {
    beforeEach(() => {
      mocks.getCurrentUser.mockResolvedValue({
        id: 'usr-1',
        email: 'operator@example.com',
        name: 'Operator',
        role: 'OWNER',
        tenantId: 'ten-1',
        mfaEnabled: false,
        tenant: { id: 'ten-1', name: 'Demo', slug: 'demo' },
      });
      mocks.prisma.user.findUnique.mockResolvedValue(makeUser({ mfaEnabled: false }));
    });

    it('enforces per-email quota after repeated invalid setup TOTP codes', async () => {
      mocks.verifyTOTP.mockReturnValue(false);

      for (let i = 1; i <= 3; i++) {
        const res = await POST(mfaRequest({ code: '000000' }, `198.51.100.${40 + i}`));
        expect(res.status).toBe(401);
        await expect(res.json()).resolves.toEqual({ error: 'Invalid verification code' });
      }

      mocks.verifyTOTP.mockClear();
      mocks.verifyTOTP.mockReturnValue(true);

      const throttled = await POST(mfaRequest({ code: '654321' }, '198.51.100.90'));

      expect(throttled.status).toBe(429);
      expect(throttled.headers.get('retry-after')).toMatch(/^[1-9]\d*$/);
      await expect(throttled.json()).resolves.toEqual({ error: EXPECTED_QUOTA_ERROR });
      expect(mocks.verifyTOTP).not.toHaveBeenCalled();
      expect(mocks.prisma.user.update).not.toHaveBeenCalled();
    });

    it('enforces per-IP quota across different authenticated users during setup verification', async () => {
      mocks.verifyTOTP.mockReturnValue(false);
      const sharedIp = '203.0.113.60';

      for (let i = 1; i <= 3; i++) {
        mocks.getCurrentUser.mockResolvedValue({
          id: `usr-${i}`,
          email: `setup-user${i}@example.com`,
          name: `User ${i}`,
          role: 'OWNER',
          tenantId: 'ten-1',
          mfaEnabled: false,
          tenant: { id: 'ten-1', name: 'Demo', slug: 'demo' },
        });
        const res = await POST(mfaRequest({ code: '000000' }, sharedIp));
        expect(res.status).toBe(401);
      }

      mocks.getCurrentUser.mockResolvedValue({
        id: 'usr-fresh',
        email: 'fresh-setup@example.com',
        name: 'Fresh',
        role: 'OWNER',
        tenantId: 'ten-1',
        mfaEnabled: false,
        tenant: { id: 'ten-1', name: 'Demo', slug: 'demo' },
      });
      mocks.verifyTOTP.mockClear();
      mocks.verifyTOTP.mockReturnValue(true);

      const throttled = await POST(mfaRequest({ code: '654321' }, sharedIp));

      expect(throttled.status).toBe(429);
      expect(throttled.headers.get('retry-after')).toMatch(/^[1-9]\d*$/);
      await expect(throttled.json()).resolves.toEqual({ error: EXPECTED_QUOTA_ERROR });
      expect(mocks.verifyTOTP).not.toHaveBeenCalled();
      expect(mocks.prisma.user.update).not.toHaveBeenCalled();
    });

    it('allows valid setup code without consuming quota budget and ignores early rejections', async () => {
      mocks.getCurrentUser.mockResolvedValueOnce(null);
      const unauth = await POST(mfaRequest({ code: '123456' }, '203.0.113.61'));
      expect(unauth.status).toBe(401);
      expect(mocks.buckets.size).toBe(0);

      mocks.prisma.user.findUnique.mockResolvedValueOnce({ mfaEnabled: false, totpSecret: null });
      const noSecret = await POST(mfaRequest({ code: '123456' }, '203.0.113.61'));
      expect(noSecret.status).toBe(400);
      expect(mocks.buckets.size).toBe(0);

      const ok = await POST(mfaRequest({ code: '654321' }, '203.0.113.61'));
      expect(ok.status).toBe(200);
      await expect(ok.json()).resolves.toEqual({
        mfaEnabled: true,
        message: 'MFA has been enabled successfully',
      });
      expect(mocks.prisma.user.update).toHaveBeenCalledTimes(1);
      for (const bucket of mocks.buckets.values()) {
        expect(bucket.count).toBe(0);
      }
    });
  });

  describe('namespace isolation & atomic reservation (no cross-lockout with login)', () => {
    it('uses mfa: keys on MFA continue failures without incrementing login: buckets', async () => {
      mocks.verifyTOTP.mockReturnValue(false);

      const res = await POST(
        mfaRequest(
          { tempToken: 'valid-temp-token', code: '000000' },
          '198.51.100.42',
        ),
      );
      expect(res.status).toBe(401);

      const startMs = computeWindowStartMs(FROZEN_NOW_MS, 60_000);
      expect(mocks.buckets.get(`mfa:email:operator@example.com:${startMs}`)?.count).toBe(1);
      expect(mocks.buckets.get(`mfa:ip:198.51.100.42:${startMs}`)?.count).toBe(1);
      expect(mocks.buckets.get(`login:email:operator@example.com:${startMs}`)).toBeUndefined();
      expect(mocks.buckets.get(`login:ip:198.51.100.42:${startMs}`)).toBeUndefined();
    });

    it('allows tempToken continue even when login: buckets are exhausted, while throttling handleMfaLogin without incrementing exhausted buckets', async () => {
      const startMs = computeWindowStartMs(FROZEN_NOW_MS, 60_000);
      const expiresAt = startMs + 60_000;
      mocks.buckets.set(`login:email:operator@example.com:${startMs}`, { count: 3, expiresAt });
      mocks.buckets.set(`login:ip:203.0.113.80:${startMs}`, { count: 3, expiresAt });

      const continueFlowRes = await POST(
        mfaRequest({ tempToken: 'valid-temp-token', code: '654321' }, '203.0.113.80'),
      );
      expect(continueFlowRes.status).toBe(200);

      const loginFlowRes = await POST(
        mfaRequest(
          { email: 'operator@example.com', password: 'correct-password', code: '654321' },
          '203.0.113.80',
        ),
      );
      expect(loginFlowRes.status).toBe(429);

      // Denied reservation must leave already-exhausted buckets untouched.
      expect(mocks.buckets.get(`login:email:operator@example.com:${startMs}`)?.count).toBe(3);
      expect(mocks.buckets.get(`login:ip:203.0.113.80:${startMs}`)?.count).toBe(3);
      expect(mocks.buckets.get(`mfa:email:operator@example.com:${startMs}`)?.count).toBe(0);
      expect(mocks.buckets.get(`mfa:ip:203.0.113.80:${startMs}`)?.count).toBe(0);
    });

    it('does not consume any bucket when denied by an exhausted IP, preventing victim lockout', async () => {
      mocks.verifyPassword.mockResolvedValue(false);
      const attackerIp = '203.0.113.99';
      const startMs = computeWindowStartMs(FROZEN_NOW_MS, 60_000);
      for (let i = 1; i <= 3; i++) {
        expect((await POST(mfaRequest({ email: 'attacker@example.com', password: 'wrong', code: '123456' }, attackerIp))).status).toBe(401);
      }

      const denied = await POST(mfaRequest({ email: 'victim@example.com', password: 'wrong', code: '123456' }, attackerIp));
      expect(denied.status).toBe(429);
      expect(mocks.buckets.get(`login:email:victim@example.com:${startMs}`)).toBeUndefined();
      expect(mocks.buckets.get(`login:ip:${attackerIp}:${startMs}`)?.count).toBe(3);

      mocks.verifyPassword.mockResolvedValue(true);
      mocks.prisma.user.findUnique.mockResolvedValue(makeUser({ email: 'victim@example.com' }));
      const victimRes = await POST(mfaRequest({ email: 'victim@example.com', password: 'correct', code: '654321' }, '203.0.113.100'));
      expect(victimRes.status).toBe(200);
    });

    it('uses mfa: keys in handleSetupVerification and ignores exhausted login: buckets', async () => {
      const startMs = computeWindowStartMs(FROZEN_NOW_MS, 60_000);
      const expiresAt = startMs + 60_000;
      mocks.buckets.set(`login:email:operator@example.com:${startMs}`, { count: 3, expiresAt });
      mocks.buckets.set(`login:ip:203.0.113.81:${startMs}`, { count: 3, expiresAt });
      mocks.getCurrentUser.mockResolvedValue({
        id: 'usr-1',
        email: 'operator@example.com',
        name: 'Operator',
        role: 'OWNER',
        tenantId: 'ten-1',
        mfaEnabled: false,
        tenant: { id: 'ten-1', name: 'Demo', slug: 'demo' },
      });
      mocks.prisma.user.findUnique.mockResolvedValue(makeUser({ mfaEnabled: false }));

      const res = await POST(mfaRequest({ code: '654321' }, '203.0.113.81'));
      expect(res.status).toBe(200);
      expect(mocks.buckets.get(`mfa:email:operator@example.com:${startMs}`)?.count).toBe(0);
      expect(mocks.buckets.get(`login:email:operator@example.com:${startMs}`)?.count).toBe(3);
    });

    it('enforces max=3 under 10 concurrent handleMfaLogin attempts via atomic reservation', async () => {
      mocks.prisma.user.findUnique.mockResolvedValue(makeUser());
      mocks.verifyPassword.mockResolvedValue(false);

      const responses = await Promise.all(
        Array.from({ length: 10 }, () =>
          POST(
            mfaRequest(
              { email: 'burst-mfa@example.com', password: 'wrong', code: '000000' },
              '198.51.100.77',
            ),
          ),
        ),
      );

      expect(responses.filter((r) => r.status === 401)).toHaveLength(3);
      expect(responses.filter((r) => r.status === 429)).toHaveLength(7);
      expect(mocks.prisma.user.findUnique).toHaveBeenCalledTimes(3);
    });

    it('shares login budget with POST /api/auth/login without locking out MFA setup verification', async () => {
      mocks.verifyPassword.mockResolvedValue(false);
      for (let i = 1; i <= 3; i++) {
        const res = await POST(
          mfaRequest({ email: 'operator@example.com', password: 'wrong', code: '123456' }, `198.51.100.${i}`),
        );
        expect(res.status).toBe(401);
      }

      mocks.getCurrentUser.mockResolvedValue({
        id: 'usr-1', email: 'operator@example.com', name: 'Operator', role: 'OWNER',
        tenantId: 'ten-1', mfaEnabled: false, tenant: { id: 'ten-1', name: 'Demo', slug: 'demo' },
      });
      mocks.prisma.user.findUnique.mockResolvedValue(makeUser({ mfaEnabled: false }));

      const setupRes = await POST(mfaRequest({ code: '654321' }, '203.0.113.90'));
      expect(setupRes.status).toBe(200);

      mocks.verifyPassword.mockResolvedValue(true);
      const loginRes = await loginPost(new NextRequest('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.91' },
        body: JSON.stringify({ email: 'operator@example.com', password: 'correct-password' }),
      }));
      expect(loginRes.status).toBe(429);
      await expect(loginRes.json()).resolves.toEqual({ error: EXPECTED_QUOTA_ERROR });
    });
  });

  describe('quota-store outage handling (fail-closed on reserve)', () => {
    it('returns 429 without running password check when quota store fails on wrong password', async () => {
      mocks.reserveError = new Error('DB down');
      mocks.verifyPassword.mockResolvedValue(false);
      const res = await POST(mfaRequest({ email: 'operator@example.com', password: 'wrong', code: '123456' }, '203.0.113.50'));
      expect(res.status).toBe(429);
      expect(res.headers.get('retry-after')).toMatch(/^[1-9]\d*$/);
      await expect(res.json()).resolves.toEqual({ error: EXPECTED_QUOTA_ERROR });
      expect(mocks.verifyPassword).not.toHaveBeenCalled();
      expect(mocks.buckets.size).toBe(0);
    });

    it('returns 429 without running TOTP check when quota store fails on wrong TOTP code', async () => {
      mocks.reserveError = new Error('DB down');
      mocks.verifyTOTP.mockReturnValue(false);
      const res = await POST(mfaRequest({ email: 'operator@example.com', password: 'correct', code: '000000' }, '203.0.113.51'));
      expect(res.status).toBe(429);
      expect(res.headers.get('retry-after')).toMatch(/^[1-9]\d*$/);
      await expect(res.json()).resolves.toEqual({ error: EXPECTED_QUOTA_ERROR });
      expect(mocks.verifyTOTP).not.toHaveBeenCalled();
      expect(mocks.buckets.size).toBe(0);
    });

    it('returns 429 on reserve outage without altering buckets, and 200 when only release fails', async () => {
      const startMs = computeWindowStartMs(FROZEN_NOW_MS, 60_000);
      mocks.buckets.set(`login:email:operator@example.com:${startMs}`, { count: 2, expiresAt: startMs + 60_000 });
      mocks.buckets.set(`login:ip:203.0.113.52:${startMs}`, { count: 2, expiresAt: startMs + 60_000 });
      mocks.reserveError = new Error('DB down');

      const res = await POST(mfaRequest({ email: 'operator@example.com', password: 'correct', code: '654321' }, '203.0.113.52'));
      expect(res.status).toBe(429);
      await expect(res.json()).resolves.toEqual({ error: EXPECTED_QUOTA_ERROR });
      expect(mocks.prisma.session.create).not.toHaveBeenCalled();
      expect(mocks.buckets.get(`login:email:operator@example.com:${startMs}`)?.count).toBe(2);
      expect(mocks.buckets.get(`login:ip:203.0.113.52:${startMs}`)?.count).toBe(2);

      mocks.reserveError = null;
      mocks.releaseError = new Error('DB down');
      const resReleaseFail = await POST(mfaRequest({ email: 'operator@example.com', password: 'correct', code: '654321' }, '203.0.113.52'));
      expect(resReleaseFail.status).toBe(200);
      expect(mocks.buckets.get(`login:email:operator@example.com:${startMs}`)?.count).toBe(3);
    });
  });
});
