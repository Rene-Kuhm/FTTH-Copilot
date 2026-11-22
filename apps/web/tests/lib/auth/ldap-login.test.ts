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
  reserveAuthQuota: vi.fn(),
  releaseAuthQuota: vi.fn(),
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
  reserveAuthQuota: mocks.reserveAuthQuota,
  releaseAuthQuota: mocks.releaseAuthQuota,
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
const { AUTH_QUOTA_ERROR_MESSAGE } = await import('@/lib/auth/quota');
const { totp } = await import('@/lib/auth/totp');

const ORIGINAL_SLUG = process.env['LDAP_TENANT_SLUG'];
const ORIGINAL_RATE_MAX = process.env['AUTH_RATE_LIMIT_MAX'];

beforeEach(() => {
  vi.clearAllMocks();
  process.env['LDAP_TENANT_SLUG'] = 'isp-demo';
  mocks.checkAuthQuota.mockResolvedValue({ allowed: true, retryAfter: 60 });
  mocks.reserveAuthQuota.mockResolvedValue({
    allowed: true,
    retryAfter: 0,
    windowStart: new Date(1_700_000_000_000),
  });
  mocks.releaseAuthQuota.mockResolvedValue(undefined);
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
  if (ORIGINAL_RATE_MAX === undefined) {
    delete process.env['AUTH_RATE_LIMIT_MAX'];
  } else {
    process.env['AUTH_RATE_LIMIT_MAX'] = ORIGINAL_RATE_MAX;
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

  it('returns 429 with retry-after when atomic reservation denies the attempt', async () => {
    mocks.reserveAuthQuota.mockResolvedValueOnce({
      allowed: false,
      retryAfter: 120,
      windowStart: new Date(1_700_000_000_000),
    });

    const res = await authenticateAndIssueLdapSession({
      req: makeReq(),
      username: 'jdoe',
      password: 'secret',
    });

    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('120');
    await expect(res.json()).resolves.toEqual({ error: AUTH_QUOTA_ERROR_MESSAGE });
    expect(mocks.authenticateLdapUser).not.toHaveBeenCalled();
    expect(mocks.releaseAuthQuota).not.toHaveBeenCalled();
  });

  it('returns 401 and keeps reservation consumed when LDAP rejects credentials', async () => {
    mocks.authenticateLdapUser.mockResolvedValueOnce({ ok: false, error: 'Invalid credentials' });
    const res = await authenticateAndIssueLdapSession({
      req: makeReq(),
      username: 'jdoe',
      password: 'wrong',
    });
    expect(res.status).toBe(401);
    expect(mocks.reserveAuthQuota).toHaveBeenCalledTimes(1);
    expect(mocks.releaseAuthQuota).not.toHaveBeenCalled();
    expect(mocks.auditLogin).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'ten-1', actorId: 'jdoe' }),
      'jdoe',
      false,
    );
  });

  it('provisions new LDAP user with mapped role, refunds quota, and issues session cookies', async () => {
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
    expect(mocks.releaseAuthQuota).toHaveBeenCalledTimes(1);
    expect(res.headers.get('set-cookie')).toContain('ftth_session=session-token');
  });

  it('blocks LDAP login with 403 MFA_SETUP_REQUIRED when tenant mandates MFA and refunds quota', async () => {
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
    expect(mocks.releaseAuthQuota).toHaveBeenCalledTimes(1);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('reuses reservedQuota from handleLogin without double-reserving and refunds on success', async () => {
    const windowStart = new Date(1_700_000_000_000);
    const reservedKeys = ['login:email:jdoe@example.invalid', 'login:ip:203.0.113.10'];

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
    mocks.prisma.user.findUnique.mockResolvedValueOnce({
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
      username: 'jdoe@example.invalid',
      password: 'secret',
      reservedQuota: { keys: reservedKeys, windowStart },
    });

    expect(res.status).toBe(200);
    expect(mocks.reserveAuthQuota).not.toHaveBeenCalled();
    expect(mocks.releaseAuthQuota).toHaveBeenCalledWith(
      reservedKeys,
      expect.any(Object),
      undefined,
      windowStart,
    );
  });

  it('records failed attempts on invalid MFA code until the quota bucket is exhausted', async () => {
    const maxAttempts = 3;
    process.env['AUTH_RATE_LIMIT_MAX'] = String(maxAttempts);

    const buckets = new Map<string, number>();
    const frozenWindowStart = new Date(1_700_000_000_000);
    mocks.authRateLimitKeys.mockImplementation((email: string, ip: string | null) => {
      const keys = [`login:email:${email.trim().toLowerCase()}`];
      if (ip) keys.push(`login:ip:${ip}`);
      return keys;
    });
    mocks.reserveAuthQuota.mockImplementation(
      async (keys: string[], opts: { max: number; windowMs: number }) => {
        const counts = keys.map((key) => {
          const next = (buckets.get(key) ?? 0) + 1;
          buckets.set(key, next);
          return next;
        });
        return counts.every((count) => count <= opts.max)
          ? { allowed: true, retryAfter: 0, windowStart: frozenWindowStart }
          : { allowed: false, retryAfter: 45, windowStart: frozenWindowStart };
      },
    );
    mocks.releaseAuthQuota.mockImplementation(async (keys: string[]) => {
      for (const key of keys) {
        const current = buckets.get(key) ?? 0;
        buckets.set(key, Math.max(current - 1, 0));
      }
    });

    const secret = 'JBSWY3DPEHPK3PXP';
    mocks.decryptApiKey.mockReturnValue(secret);
    const now = Date.now();
    const validCodes = new Set([totp(secret, now - 30000), totp(secret, now), totp(secret, now + 30000)]);
    const wrongCode = ['000000', '111111', '222222', '333333'].find((c) => !validCodes.has(c))!;

    mocks.authenticateLdapUser.mockResolvedValue({
      ok: true,
      user: {
        dn: 'uid=jdoe,ou=users,dc=example,dc=com',
        email: 'jdoe@example.invalid',
        name: 'Jane Doe',
        groups: ['CN=NOC-Ops'],
        role: 'OPERATOR',
      },
    });
    mocks.prisma.user.findUnique.mockResolvedValue({
      id: 'usr-ldap-1',
      email: 'jdoe@example.invalid',
      name: 'Jane Doe',
      role: 'OPERATOR',
      tenantId: 'ten-1',
      mfaEnabled: true,
      totpSecret: 'enc-totp-secret',
    });

    for (let i = 0; i < maxAttempts; i++) {
      const res = await authenticateAndIssueLdapSession({
        req: makeReq(),
        username: 'jdoe',
        password: 'secret',
        code: wrongCode,
      });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'Invalid MFA code' });
    }

    expect(mocks.reserveAuthQuota).toHaveBeenCalledTimes(maxAttempts);
    expect(buckets.get('login:email:jdoe')).toBe(maxAttempts);
    expect(buckets.get('login:ip:203.0.113.10')).toBe(maxAttempts);

    const blockedRes = await authenticateAndIssueLdapSession({
      req: makeReq(),
      username: 'jdoe',
      password: 'secret',
      code: wrongCode,
    });
    expect(blockedRes.status).toBe(429);
    expect(blockedRes.headers.get('retry-after')).toBe('45');
    await expect(blockedRes.json()).resolves.toEqual({ error: AUTH_QUOTA_ERROR_MESSAGE });
    expect(mocks.authenticateLdapUser).toHaveBeenCalledTimes(maxAttempts);
  });

  it('emits ftth_session and ftth_csrf as two separate Set-Cookie headers', async () => {
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
    mocks.prisma.user.findUnique.mockResolvedValueOnce({
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
    const setCookies = res.headers.getSetCookie();
    expect(setCookies).toHaveLength(2);
    expect(setCookies.some((c) => c.startsWith('ftth_session=session-token'))).toBe(true);
    expect(setCookies.some((c) => c.startsWith('ftth_csrf='))).toBe(true);
    expect(setCookies.every((c) => !(c.includes('ftth_session=') && c.includes('ftth_csrf=')))).toBe(true);
  });
});
