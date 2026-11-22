import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

interface Bucket {
  count: number;
  expiresAt: number;
}

const EXPECTED_QUOTA_ERROR = 'Demasiados intentos. Probá de nuevo más tarde.';
const FROZEN_NOW_MS = 1_700_000_000_000;

const mocks = vi.hoisted(() => {
  const buckets = new Map<string, Bucket>();

  return {
    buckets,
    prisma: {
      user: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
    },
    decryptApiKey: vi.fn(),
    encryptApiKey: vi.fn(),
    verifyTOTP: vi.fn(),
    generateSecret: vi.fn(),
    generateOtpAuthUri: vi.fn(),
    getCurrentUser: vi.fn(),
    auditLogin: vi.fn(),
  };
});

function computeWindowStartMs(nowMs: number, windowMs: number): number {
  return Math.floor(nowMs / windowMs) * windowMs;
}

function retryAfterSeconds(nowMs: number, windowStartMs: number, windowMs: number): number {
  return Math.max(1, Math.ceil((windowStartMs + windowMs - nowMs) / 1000));
}

vi.mock('@ftth-copilot/db', () => ({
  prisma: mocks.prisma,
  decryptApiKey: mocks.decryptApiKey,
  encryptApiKey: mocks.encryptApiKey,
  extractClientIp: (xForwardedFor: string | null | undefined): string | null => {
    if (!xForwardedFor) return null;
    const first = xForwardedFor.split(',')[0]?.trim();
    return first && first.length > 0 ? first : null;
  },
  authRateLimitKeys: (
    email: string,
    ip: string | null,
    scope: 'login' | 'mfa' = 'login',
  ): string[] => {
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
}));

vi.mock('@/lib/auth/totp', () => ({
  verifyTOTP: mocks.verifyTOTP,
  generateSecret: mocks.generateSecret,
  generateOtpAuthUri: mocks.generateOtpAuthUri,
}));

vi.mock('@/lib/auth/server', () => ({
  getCurrentUser: mocks.getCurrentUser,
}));

vi.mock('@ftth-copilot/soc', () => ({
  auditAuth: { login: mocks.auditLogin },
}));

const { POST: disablePost } = await import('@/app/api/auth/mfa/disable/route');
const { DELETE: setupDelete } = await import('@/app/api/auth/mfa/setup/route');

function disableRequest(body: unknown, ip?: string): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (ip) {
    headers['x-forwarded-for'] = ip;
  }
  return new NextRequest('http://localhost/api/auth/mfa/disable', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

function setupDeleteRequest(body: unknown, ip?: string): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (ip) {
    headers['x-forwarded-for'] = ip;
  }
  return new Request('http://localhost/api/auth/mfa/setup', {
    method: 'DELETE',
    headers,
    body: JSON.stringify(body),
  });
}

function makeCurrentUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'usr-1',
    email: 'operator@example.com',
    name: 'Operator',
    role: 'OWNER',
    tenantId: 'ten-1',
    mfaEnabled: true,
    tenant: { id: 'ten-1', name: 'Demo', slug: 'demo' },
    ...overrides,
  };
}

describe('MFA disable brute-force quota', () => {
  let prevMax: string | undefined;
  let prevWindowMs: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.buckets.clear();

    prevMax = process.env['AUTH_RATE_LIMIT_MAX'];
    prevWindowMs = process.env['AUTH_RATE_LIMIT_WINDOW_MS'];
    process.env['AUTH_RATE_LIMIT_MAX'] = '3';
    process.env['AUTH_RATE_LIMIT_WINDOW_MS'] = '60000';

    mocks.getCurrentUser.mockResolvedValue(makeCurrentUser());
    mocks.prisma.user.findUnique.mockResolvedValue({
      mfaEnabled: true,
      totpSecret: 'encrypted-secret',
    });
    mocks.prisma.user.update.mockResolvedValue({});
    mocks.decryptApiKey.mockReturnValue('JBSWY3DPEHPK3PXP');
    mocks.verifyTOTP.mockReturnValue(true);
  });

  afterEach(() => {
    if (prevMax === undefined) delete process.env['AUTH_RATE_LIMIT_MAX'];
    else process.env['AUTH_RATE_LIMIT_MAX'] = prevMax;

    if (prevWindowMs === undefined) delete process.env['AUTH_RATE_LIMIT_WINDOW_MS'];
    else process.env['AUTH_RATE_LIMIT_WINDOW_MS'] = prevWindowMs;
  });

  describe('POST /api/auth/mfa/disable', () => {
    it('enforces quota after N invalid TOTP codes and returns 429 with retry-after', async () => {
      mocks.verifyTOTP.mockReturnValue(false);

      for (let i = 1; i <= 3; i++) {
        const res = await disablePost(disableRequest({ code: '000000' }, `198.51.100.${i}`));
        expect(res.status).toBe(401);
        await expect(res.json()).resolves.toEqual({ error: 'Código MFA inválido' });
      }

      mocks.verifyTOTP.mockClear();
      mocks.verifyTOTP.mockReturnValue(true);

      const throttled = await disablePost(disableRequest({ code: '654321' }, '198.51.100.99'));

      expect(throttled.status).toBe(429);
      expect(throttled.headers.get('retry-after')).toMatch(/^[1-9]\d*$/);
      await expect(throttled.json()).resolves.toEqual({ error: EXPECTED_QUOTA_ERROR });
      expect(mocks.verifyTOTP).not.toHaveBeenCalled();
      expect(mocks.prisma.user.update).not.toHaveBeenCalled();
    });

    it('succeeds with 200 { ok: true } on valid code without consuming budget', async () => {
      const res = await disablePost(disableRequest({ code: '654321' }, '203.0.113.10'));

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({
        ok: true,
        message: 'MFA deshabilitado correctamente',
      });
      expect(mocks.prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'usr-1' },
        data: { mfaEnabled: false, totpSecret: null },
      });
      expect(mocks.buckets.size).toBe(0);
    });

    it('does not consume budget on early rejections before TOTP check', async () => {
      mocks.getCurrentUser.mockResolvedValueOnce(null);
      const unauth = await disablePost(disableRequest({ code: '000000' }, '203.0.113.11'));
      expect(unauth.status).toBe(401);

      const missingCode = await disablePost(disableRequest({}, '203.0.113.11'));
      expect(missingCode.status).toBe(400);

      mocks.prisma.user.findUnique.mockResolvedValueOnce({ mfaEnabled: false, totpSecret: null });
      const notEnabled = await disablePost(disableRequest({ code: '000000' }, '203.0.113.11'));
      expect(notEnabled.status).toBe(400);

      expect(mocks.buckets.size).toBe(0);
    });

    it('uses the mfa bucket and is not blocked by an exhausted login email bucket', async () => {
      const windowStartMs = computeWindowStartMs(FROZEN_NOW_MS, 60_000);
      mocks.buckets.set(`login:email:operator@example.com:${windowStartMs}`, {
        count: 3,
        expiresAt: windowStartMs + 60_000,
      });

      const ok = await disablePost(disableRequest({ code: '654321' }, '203.0.113.12'));
      expect(ok.status).toBe(200);

      mocks.verifyTOTP.mockReturnValue(false);
      const fail = await disablePost(disableRequest({ code: '000000' }, '203.0.113.13'));
      expect(fail.status).toBe(401);
      expect(mocks.buckets.has(`mfa:email:operator@example.com:${windowStartMs}`)).toBe(true);
    });
  });

  describe('DELETE /api/auth/mfa/setup', () => {
    it('enforces quota after N invalid TOTP codes and returns 429 with retry-after', async () => {
      mocks.verifyTOTP.mockReturnValue(false);

      for (let i = 1; i <= 3; i++) {
        const res = await setupDelete(setupDeleteRequest({ code: '000000' }, `198.51.100.${10 + i}`));
        expect(res.status).toBe(401);
        await expect(res.json()).resolves.toEqual({ error: 'Invalid verification code' });
      }

      mocks.verifyTOTP.mockClear();
      mocks.verifyTOTP.mockReturnValue(true);

      const throttled = await setupDelete(setupDeleteRequest({ code: '654321' }, '198.51.100.99'));

      expect(throttled.status).toBe(429);
      expect(throttled.headers.get('retry-after')).toMatch(/^[1-9]\d*$/);
      await expect(throttled.json()).resolves.toEqual({ error: EXPECTED_QUOTA_ERROR });
      expect(mocks.verifyTOTP).not.toHaveBeenCalled();
      expect(mocks.prisma.user.update).not.toHaveBeenCalled();
    });

    it('succeeds with 200 { mfaEnabled: false } on valid code without consuming budget', async () => {
      const res = await setupDelete(setupDeleteRequest({ code: '654321' }, '203.0.113.20'));

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ mfaEnabled: false });
      expect(mocks.prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'usr-1' },
        data: { mfaEnabled: false, totpSecret: null },
      });
      expect(mocks.buckets.size).toBe(0);
    });

    it('does not consume budget on early rejections before TOTP check', async () => {
      mocks.getCurrentUser.mockResolvedValueOnce(null);
      const unauth = await setupDelete(setupDeleteRequest({ code: '000000' }, '203.0.113.21'));
      expect(unauth.status).toBe(401);

      const missingCode = await setupDelete(setupDeleteRequest({}, '203.0.113.21'));
      expect(missingCode.status).toBe(400);

      mocks.prisma.user.findUnique.mockResolvedValueOnce({ mfaEnabled: false, totpSecret: null });
      const notConfigured = await setupDelete(setupDeleteRequest({ code: '000000' }, '203.0.113.21'));
      expect(notConfigured.status).toBe(400);

      expect(mocks.buckets.size).toBe(0);
    });

    it('uses the mfa bucket and is not blocked by an exhausted login email bucket', async () => {
      const windowStartMs = computeWindowStartMs(FROZEN_NOW_MS, 60_000);
      mocks.buckets.set(`login:email:operator@example.com:${windowStartMs}`, {
        count: 3,
        expiresAt: windowStartMs + 60_000,
      });

      const ok = await setupDelete(setupDeleteRequest({ code: '654321' }, '203.0.113.22'));
      expect(ok.status).toBe(200);

      mocks.verifyTOTP.mockReturnValue(false);
      const fail = await setupDelete(setupDeleteRequest({ code: '000000' }, '203.0.113.23'));
      expect(fail.status).toBe(401);
      expect(mocks.buckets.has(`mfa:email:operator@example.com:${windowStartMs}`)).toBe(true);
    });
  });
});
