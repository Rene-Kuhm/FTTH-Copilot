import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  prisma: {
    tenant: { findUnique: vi.fn() },
    tenantPolicy: { findUnique: vi.fn() },
    user: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    session: { create: vi.fn() },
  },
  checkAuthQuota: vi.fn(),
  recordAuthAttempt: vi.fn(),
  authRateLimitKeys: vi.fn(),
  extractClientIp: vi.fn(),
  hashPassword: vi.fn(),
  issueToken: vi.fn(),
  sessionCookieAttributes: vi.fn(),
  decryptApiKey: vi.fn(),
  authenticateLdapUser: vi.fn(),
  auditLogin: vi.fn(),
}));

vi.mock('@ftth-copilot/db', () => ({
  prisma: mocks.prisma,
  COOKIE_NAME: 'ftth_session',
  TOKEN_TTL_SECONDS: 3600,
  checkAuthQuota: mocks.checkAuthQuota,
  recordAuthAttempt: mocks.recordAuthAttempt,
  authRateLimitKeys: mocks.authRateLimitKeys,
  extractClientIp: mocks.extractClientIp,
  hashPassword: mocks.hashPassword,
  issueToken: mocks.issueToken,
  sessionCookieAttributes: mocks.sessionCookieAttributes,
  decryptApiKey: mocks.decryptApiKey,
}));

vi.mock('@ftth-copilot/soc', () => ({
  authenticateLdapUser: mocks.authenticateLdapUser,
  auditAuth: { login: mocks.auditLogin },
}));

const { authenticateAndIssueLdapSession } = await import('@/lib/auth/ldap-login');

const ORIGINAL_SLUG = process.env['LDAP_TENANT_SLUG'];

beforeEach(() => {
  vi.clearAllMocks();
  process.env['LDAP_TENANT_SLUG'] = 'isp-demo';
  mocks.checkAuthQuota.mockResolvedValue({ allowed: true, retryAfter: 60 });
  mocks.authRateLimitKeys.mockReturnValue(['ip:203.0.113.10']);
  mocks.extractClientIp.mockReturnValue('203.0.113.10');
  mocks.hashPassword.mockResolvedValue('random-hash');
  mocks.issueToken.mockImplementation((_u: string, _t: string, _r: string, isTemp?: boolean) => ({
    token: isTemp ? 'temp-token' : 'session-token',
    tokenHash: 'sha256:token',
    expiresAt: new Date(Date.now() + 3600_000),
  }));
  mocks.sessionCookieAttributes.mockReturnValue({ path: '/', sameSite: 'lax', secure: false });
  mocks.prisma.tenant.findUnique.mockResolvedValue({ id: 'ten-1', name: 'ISP Demo', slug: 'isp-demo' });
  mocks.prisma.tenantPolicy.findUnique.mockResolvedValue({ requireMfa: false });
});

afterEach(() => {
  if (ORIGINAL_SLUG === undefined) {
    delete process.env['LDAP_TENANT_SLUG'];
  } else {
    process.env['LDAP_TENANT_SLUG'] = ORIGINAL_SLUG;
  }
});

function makeReq(): Request {
  return new Request('http://localhost/api/auth/ldap/login', {
    method: 'POST',
    headers: { 'user-agent': 'vitest' },
  });
}

describe('authenticateAndIssueLdapSession', () => {
  it('fails closed when LDAP_TENANT_SLUG is missing', async () => {
    delete process.env['LDAP_TENANT_SLUG'];
    const res = await authenticateAndIssueLdapSession({
      req: makeReq(),
      username: 'jdoe',
      password: 'secret',
    });
    expect(res.status).toBe(500);
    expect(mocks.authenticateLdapUser).not.toHaveBeenCalled();
  });

  it('returns 401 and records failed attempt when LDAP rejects credentials', async () => {
    mocks.authenticateLdapUser.mockResolvedValueOnce({ ok: false, error: 'Invalid credentials' });
    const res = await authenticateAndIssueLdapSession({
      req: makeReq(),
      username: 'jdoe',
      password: 'wrong',
    });
    expect(res.status).toBe(401);
    expect(mocks.recordAuthAttempt).toHaveBeenCalledTimes(1);
    expect(mocks.auditLogin).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'ten-1', actorId: 'jdoe' }),
      'jdoe',
      false,
    );
  });

  it('provisions new LDAP user with mapped role and issues session cookies', async () => {
    mocks.authenticateLdapUser.mockResolvedValueOnce({
      ok: true,
      user: {
        dn: 'uid=jdoe,ou=users,dc=example,dc=com',
        email: 'jdoe@example.invalid',
        name: 'Jane Doe',
        groups: ['CN=NOC-Admins'],
        role: 'ADMIN',
      },
    });
    mocks.prisma.user.findUnique.mockResolvedValueOnce(null);
    mocks.prisma.user.create.mockResolvedValueOnce({
      id: 'usr-ldap-1',
      email: 'jdoe@example.invalid',
      name: 'Jane Doe',
      role: 'ADMIN',
      tenantId: 'ten-1',
      mfaEnabled: false,
      totpSecret: null,
    });

    const res = await authenticateAndIssueLdapSession({
      req: makeReq(),
      username: 'jdoe',
      password: 'secret',
    });

    expect(res.status).toBe(200);
    expect(mocks.prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'jdoe@example.invalid',
          role: 'ADMIN',
          tenantId: 'ten-1',
        }),
      }),
    );
    expect(mocks.prisma.session.create).toHaveBeenCalledTimes(1);
    expect(res.headers.get('set-cookie')).toContain('ftth_session=session-token');
  });

  it('blocks LDAP login with 403 MFA_SETUP_REQUIRED when tenant mandates MFA and user has no TOTP', async () => {
    mocks.prisma.tenantPolicy.findUnique.mockResolvedValueOnce({ requireMfa: true });
    mocks.authenticateLdapUser.mockResolvedValueOnce({
      ok: true,
      user: {
        dn: 'uid=jdoe,ou=users,dc=example,dc=com',
        email: 'jdoe@example.invalid',
        name: 'Jane Doe',
        groups: ['CN=NOC-Ops'],
        role: 'OPERATOR',
      },
    });
    mocks.prisma.user.findUnique.mockResolvedValueOnce({
      id: 'usr-ldap-1',
      email: 'jdoe@example.invalid',
      name: 'Jane Doe',
      role: 'OPERATOR',
      tenantId: 'ten-1',
      mfaEnabled: false,
      totpSecret: null,
    });

    const res = await authenticateAndIssueLdapSession({
      req: makeReq(),
      username: 'jdoe',
      password: 'secret',
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toMatchObject({
      code: 'MFA_SETUP_REQUIRED',
      mfaSetupRequired: true,
      tempToken: 'temp-token',
    });
    expect(mocks.prisma.session.create).not.toHaveBeenCalled();
    expect(res.headers.get('set-cookie')).toBeNull();
  });
});
