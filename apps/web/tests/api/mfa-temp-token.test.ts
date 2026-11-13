import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import jwt from 'jsonwebtoken';

const mocks = vi.hoisted(() => ({
  verifyTOTP: vi.fn(),
  auditAuth: { login: vi.fn() },
  usedTempKeys: new Set<string>(),
  prisma: {
    user: { findUnique: vi.fn(), update: vi.fn() },
    session: { findUnique: vi.fn(), create: vi.fn() },
    authRateLimit: { create: vi.fn() },
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
  process.env['JWT_SECRET'] = 'test-secret-for-mfa-temp-token-tests-32b';
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
});
