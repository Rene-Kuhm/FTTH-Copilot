import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  isTenantMfaRequired: vi.fn(),
  prisma: {
    tenantPolicy: { upsert: vi.fn() },
    user: { findUnique: vi.fn(), update: vi.fn() },
  },
  decryptApiKey: vi.fn(),
}));

vi.mock('@/lib/auth/server', () => ({
  getCurrentUser: mocks.getCurrentUser,
}));

vi.mock('@/lib/auth/mfa-policy', () => ({
  isTenantMfaRequired: mocks.isTenantMfaRequired,
}));

vi.mock('@ftth-copilot/db', () => ({
  prisma: mocks.prisma,
  decryptApiKey: mocks.decryptApiKey,
}));

const mfaPolicyRoute = await import('@/app/api/security/mfa-policy/route');
const mfaDisableRoute = await import('@/app/api/auth/mfa/disable/route');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('tenant MFA policy API & disable guard', () => {
  it('GET /api/security/mfa-policy returns 401 when unauthenticated', async () => {
    mocks.getCurrentUser.mockResolvedValueOnce(null);
    const res = await mfaPolicyRoute.GET();
    expect(res.status).toBe(401);
  });

  it('PUT /api/security/mfa-policy rejects non-admin roles with 403', async () => {
    mocks.getCurrentUser.mockResolvedValueOnce({
      id: 'u1',
      tenantId: 'ten-1',
      role: 'OPERATOR',
    });
    const req = new Request('http://localhost/api/security/mfa-policy', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requireMfa: true }),
    });
    const res = await mfaPolicyRoute.PUT(req);
    expect(res.status).toBe(403);
    expect(mocks.prisma.tenantPolicy.upsert).not.toHaveBeenCalled();
  });

  it('PUT /api/security/mfa-policy allows OWNER/ADMIN to enable requireMfa', async () => {
    mocks.getCurrentUser.mockResolvedValueOnce({
      id: 'u1',
      tenantId: 'ten-1',
      role: 'ADMIN',
    });
    mocks.prisma.tenantPolicy.upsert.mockResolvedValueOnce({ requireMfa: true });
    const req = new Request('http://localhost/api/security/mfa-policy', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requireMfa: true }),
    });
    const res = await mfaPolicyRoute.PUT(req);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ requireMfa: true });
  });

  it('POST /api/auth/mfa/disable blocks disabling MFA when tenant requires it and scopes to session tenantId', async () => {
    mocks.getCurrentUser.mockResolvedValueOnce({
      id: 'u1',
      tenantId: 'ten-1',
      role: 'OPERATOR',
    });
    mocks.isTenantMfaRequired.mockResolvedValueOnce(true);

    const req = new NextRequest('http://localhost/api/auth/mfa/disable', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: '123456', tenantId: 'ten-other' }),
    });
    const res = await mfaDisableRoute.POST(req);
    expect(res.status).toBe(403);
    expect(mocks.isTenantMfaRequired).toHaveBeenCalledWith('ten-1');
    expect(mocks.prisma.user.update).not.toHaveBeenCalled();
  });

  it('middleware verifyToken rejects MFA tempToken so it cannot access protected routes', async () => {
    const { SignJWT } = await import('jose');
    const prevSecret = process.env['JWT_SECRET'];
    process.env['JWT_SECRET'] = 'test-secret-for-temp-token-scope-check-32b';
    try {
      const secret = new TextEncoder().encode(process.env['JWT_SECRET']);
      const tempJwt = await new SignJWT({ sub: 'u1', tenantId: 'ten-1', role: 'OWNER', isTemp: true })
        .setProtectedHeader({ alg: 'HS256' })
        .setExpirationTime('5m')
        .sign(secret);

      const { verifyToken } = await import('@/middleware/jwt-verify');
      await expect(verifyToken(tempJwt)).resolves.toBeNull();
    } finally {
      if (prevSecret === undefined) {
        delete process.env['JWT_SECRET'];
      } else {
        process.env['JWT_SECRET'] = prevSecret;
      }
    }
  });
});
