import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import jwt from 'jsonwebtoken';

const mocks = vi.hoisted(() => ({
  verifyTOTP: vi.fn(),
  auditAuth: { login: vi.fn() },
  usedTempKeys: new Set<string>(),
  failCounts: new Map<string, number>(),
  prisma: {
    user: { findUnique: vi.fn(), update: vi.fn() },
    session: { findUnique: vi.fn(), create: vi.fn() },
    authRateLimit: { create: vi.fn(), findUnique: vi.fn(), upsert: vi.fn() },
  },
  decryptApiKey: vi.fn(),
}));

vi.mock('@/lib/auth/totp', () => ({
  verifyTOTP: mocks.verifyTOTP,
}));

vi.mock('@ftth-copilot/soc', () => ({
  auditAuth: mocks.auditAuth,
}));

vi.mock('@ftth-copilot/db', async () => {
  const actual = await vi.importActual<typeof import('@ftth-copilot/db')>('@ftth-copilot/db');
  return {
    ...actual,
    prisma: mocks.prisma,
    decryptApiKey: mocks.decryptApiKey,
  };
});

const prevJwtSecret = process.env['JWT_SECRET'];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.usedTempKeys.clear();
  mocks.failCounts.clear();
  process.env['JWT_SECRET'] = 'test-secret-for-mfa-temp-token-tests-32b';
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
});

afterEach(() => {
  if (prevJwtSecret === undefined) {
    delete process.env['JWT_SECRET'];
  } else {
    process.env['JWT_SECRET'] = prevJwtSecret;
  }
});

describe('MFA tempToken lifecycle & restrictions', () => {
  it('handleMe rejects MFA tempToken presented as session cookie', async () => {
    const { issueToken, COOKIE_NAME } = await import('@ftth-copilot/db');
    const { handleMe } = await import('@/lib/auth/server');
    const { token: tempToken } = issueToken('u1', 'ten-1', 'OWNER', true);

    const req = new Request('http://localhost/api/auth/me', {
      headers: { cookie: `${COOKIE_NAME}=${tempToken}` },
    });
    const res = await handleMe(req);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ user: null });
    expect(mocks.prisma.session.findUnique).not.toHaveBeenCalled();
  });

  it('POST /api/auth/mfa/verify rejects expired tempToken with 401', async () => {
    const mfaVerifyRoute = await import('@/app/api/auth/mfa/verify/route');
    const expiredTempToken = jwt.sign(
      { sub: 'u1', tenantId: 'ten-1', role: 'OPERATOR', isTemp: true },
      process.env['JWT_SECRET']!,
      { expiresIn: -10 },
    );

    const req = new NextRequest('http://localhost/api/auth/mfa/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tempToken: expiredTempToken, code: '123456' }),
    });
    const res = await mfaVerifyRoute.POST(req);
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: 'Invalid or expired temp token' });
    expect(mocks.prisma.session.create).not.toHaveBeenCalled();
  });

  it('POST /api/auth/mfa/verify invalidates tempToken after completion so replay fails with 401', async () => {
    const { issueToken } = await import('@ftth-copilot/db');
    const mfaVerifyRoute = await import('@/app/api/auth/mfa/verify/route');
    const { token: tempToken } = issueToken('u1', 'ten-1', 'OPERATOR', true);

    const userRecord = {
      id: 'u1',
      email: 'user@example.com',
      name: 'User',
      role: 'OPERATOR',
      tenantId: 'ten-1',
      mfaEnabled: true,
      totpSecret: { encryptedKey: 'enc' },
    };
    mocks.prisma.user.findUnique.mockResolvedValue(userRecord);
    mocks.decryptApiKey.mockReturnValue('JBSWY3DPEHPK3PXP');
    mocks.verifyTOTP.mockReturnValue(true);
    mocks.prisma.session.create.mockResolvedValue({ id: 'sess-1' });
    mocks.auditAuth.login.mockResolvedValue(undefined);

    const firstReq = new NextRequest('http://localhost/api/auth/mfa/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tempToken, code: '123456' }),
    });
    const firstRes = await mfaVerifyRoute.POST(firstReq);
    expect(firstRes.status).toBe(200);
    expect(mocks.prisma.session.create).toHaveBeenCalledTimes(1);

    const replayReq = new NextRequest('http://localhost/api/auth/mfa/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tempToken, code: '123456' }),
    });
    const replayRes = await mfaVerifyRoute.POST(replayReq);
    expect(replayRes.status).toBe(401);
    await expect(replayRes.json()).resolves.toEqual({ error: 'Invalid or expired temp token' });
    expect(mocks.prisma.session.create).toHaveBeenCalledTimes(1);
  });

  it('POST /api/auth/mfa/verify locks tempToken after 5 invalid codes so the 6th attempt with a valid code returns 401', async () => {
    const { issueToken } = await import('@ftth-copilot/db');
    const mfaVerifyRoute = await import('@/app/api/auth/mfa/verify/route');
    const { token: tempToken } = issueToken('u1', 'ten-1', 'OPERATOR', true);

    mocks.prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      email: 'user@example.com',
      name: 'User',
      role: 'OPERATOR',
      tenantId: 'ten-1',
      mfaEnabled: true,
      totpSecret: { encryptedKey: 'enc' },
    });
    mocks.decryptApiKey.mockReturnValue('JBSWY3DPEHPK3PXP');
    mocks.verifyTOTP.mockReturnValue(false);

    for (let i = 1; i <= 5; i += 1) {
      const req = new NextRequest('http://localhost/api/auth/mfa/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tempToken, code: '000000' }),
      });
      const res = await mfaVerifyRoute.POST(req);
      expect(res.status).toBe(401);
      if (i < 5) {
        await expect(res.json()).resolves.toEqual({ error: 'Invalid MFA code' });
      } else {
        await expect(res.json()).resolves.toEqual({ error: 'Invalid or expired temp token' });
      }
    }

    mocks.verifyTOTP.mockReturnValue(true);
    const sixthReq = new NextRequest('http://localhost/api/auth/mfa/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tempToken, code: '123456' }),
    });
    const sixthRes = await mfaVerifyRoute.POST(sixthReq);
    expect(sixthRes.status).toBe(401);
    await expect(sixthRes.json()).resolves.toEqual({ error: 'Invalid or expired temp token' });
    expect(mocks.prisma.session.create).not.toHaveBeenCalled();
  });

  it('POST /api/auth/mfa/verify allows login on the 5th attempt with a valid code after 4 invalid codes', async () => {
    const { issueToken } = await import('@ftth-copilot/db');
    const mfaVerifyRoute = await import('@/app/api/auth/mfa/verify/route');
    const { token: tempToken } = issueToken('u1', 'ten-1', 'OPERATOR', true);

    mocks.prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      email: 'user@example.com',
      name: 'User',
      role: 'OPERATOR',
      tenantId: 'ten-1',
      mfaEnabled: false,
      totpSecret: { encryptedKey: 'enc' },
    });
    mocks.decryptApiKey.mockReturnValue('JBSWY3DPEHPK3PXP');
    mocks.prisma.user.update.mockResolvedValue({ id: 'u1', mfaEnabled: true });
    mocks.prisma.session.create.mockResolvedValue({ id: 'sess-1' });
    mocks.auditAuth.login.mockResolvedValue(undefined);

    mocks.verifyTOTP.mockReturnValue(false);
    for (let i = 0; i < 4; i += 1) {
      const req = new NextRequest('http://localhost/api/auth/mfa/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tempToken, code: '000000' }),
      });
      const res = await mfaVerifyRoute.POST(req);
      expect(res.status).toBe(401);
      await expect(res.json()).resolves.toEqual({ error: 'Invalid MFA code' });
    }

    mocks.verifyTOTP.mockReturnValue(true);
    const fifthReq = new NextRequest('http://localhost/api/auth/mfa/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tempToken, code: '123456' }),
    });
    const fifthRes = await mfaVerifyRoute.POST(fifthReq);
    expect(fifthRes.status).toBe(200);
    expect(mocks.prisma.user.update).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.session.create).toHaveBeenCalledTimes(1);
  });

  it('POST /api/auth/mfa/verify scopes invalid attempt counter per tempToken so a new token starts at 0', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-11-13T17:00:00Z'));
      const { issueToken } = await import('@ftth-copilot/db');
      const mfaVerifyRoute = await import('@/app/api/auth/mfa/verify/route');
      const { token: firstTempToken } = issueToken('u1', 'ten-1', 'OPERATOR', true);
      vi.setSystemTime(new Date('2026-11-13T17:00:02Z'));
      const { token: secondTempToken } = issueToken('u1', 'ten-1', 'OPERATOR', true);
      expect(secondTempToken).not.toBe(firstTempToken);

      mocks.prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'user@example.com',
        name: 'User',
        role: 'OPERATOR',
        tenantId: 'ten-1',
        mfaEnabled: true,
        totpSecret: { encryptedKey: 'enc' },
      });
      mocks.decryptApiKey.mockReturnValue('JBSWY3DPEHPK3PXP');
      mocks.prisma.session.create.mockResolvedValue({ id: 'sess-2' });
      mocks.auditAuth.login.mockResolvedValue(undefined);

      mocks.verifyTOTP.mockReturnValue(false);
      for (let i = 0; i < 5; i += 1) {
        const req = new NextRequest('http://localhost/api/auth/mfa/verify', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ tempToken: firstTempToken, code: '000000' }),
        });
        await mfaVerifyRoute.POST(req);
      }

      mocks.verifyTOTP.mockReturnValue(true);
      const newTokenReq = new NextRequest('http://localhost/api/auth/mfa/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tempToken: secondTempToken, code: '123456' }),
      });
      const newTokenRes = await mfaVerifyRoute.POST(newTokenReq);
      expect(newTokenRes.status).toBe(200);
      expect(mocks.prisma.session.create).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('POST /api/auth/mfa/verify evaluates at most 5 TOTP codes per tempToken under concurrent requests', async () => {
    const { issueToken } = await import('@ftth-copilot/db');
    const mfaVerifyRoute = await import('@/app/api/auth/mfa/verify/route');
    const { token: tempToken } = issueToken('u1', 'ten-1', 'OPERATOR', true);

    mocks.prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      email: 'user@example.com',
      name: 'User',
      role: 'OPERATOR',
      tenantId: 'ten-1',
      mfaEnabled: true,
      totpSecret: { encryptedKey: 'enc' },
    });
    mocks.decryptApiKey.mockReturnValue('JBSWY3DPEHPK3PXP');
    mocks.verifyTOTP.mockReturnValue(false);

    const concurrentRequests = Array.from({ length: 20 }, (_, i) =>
      mfaVerifyRoute.POST(
        new NextRequest('http://localhost/api/auth/mfa/verify', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ tempToken, code: String(i).padStart(6, '0') }),
        }),
      ),
    );
    const responses = await Promise.all(concurrentRequests);
    for (const res of responses) {
      expect(res.status).toBe(401);
    }
    expect(mocks.verifyTOTP.mock.calls.length).toBeLessThanOrEqual(5);

    mocks.verifyTOTP.mockReturnValue(true);
    const laterRes = await mfaVerifyRoute.POST(
      new NextRequest('http://localhost/api/auth/mfa/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tempToken, code: '123456' }),
      }),
    );
    expect(laterRes.status).toBe(401);
    await expect(laterRes.json()).resolves.toEqual({ error: 'Invalid or expired temp token' });
    expect(mocks.prisma.session.create).not.toHaveBeenCalled();
  });
});
