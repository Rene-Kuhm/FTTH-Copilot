import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  buckets: new Map<string, { count: number; expiresAt: number }>(),
  discovery: vi.fn(),
  randomPKCECodeVerifier: vi.fn(() => 'pkce-verifier-123'),
  calculatePKCECodeChallenge: vi.fn(async () => 'pkce-challenge-123'),
  randomState: vi.fn(() => 'state-123'),
  randomNonce: vi.fn(() => 'nonce-123'),
  buildAuthorizationUrl: vi.fn(
    () => new URL('https://idp.example.com/auth?state=state-123&nonce=nonce-123'),
  ),
  authorizationCodeGrant: vi.fn(),
  fetchUserInfo: vi.fn(),
  tenantFindUnique: vi.fn(),
  tenantPolicyFindUnique: vi.fn(),
  userIdentityFindUnique: vi.fn(),
  userIdentityCreate: vi.fn(),
  userFindUnique: vi.fn(),
  userFindUniqueOrThrow: vi.fn(),
  userCreate: vi.fn(),
  sessionCreate: vi.fn(),
  transaction: vi.fn(),
  audit: vi.fn(),
  auditLogin: vi.fn(),
  authRateLimitKeys: vi.fn(),
  reserveAuthQuota: vi.fn(),
  releaseAuthQuota: vi.fn(),
  extractClientIp: vi.fn(() => '192.0.2.10'),
}));

const FROZEN_NOW_MS = 1_700_000_000_000;

function computeWindowStartMs(nowMs: number, windowMs: number): number {
  return Math.floor(nowMs / windowMs) * windowMs;
}

function retryAfterSeconds(nowMs: number, windowStartMs: number, windowMs: number): number {
  return Math.max(1, Math.ceil((windowStartMs + windowMs - nowMs) / 1000));
}

vi.mock('openid-client', () => ({
  discovery: mocks.discovery,
  randomPKCECodeVerifier: mocks.randomPKCECodeVerifier,
  calculatePKCECodeChallenge: mocks.calculatePKCECodeChallenge,
  randomState: mocks.randomState,
  randomNonce: mocks.randomNonce,
  buildAuthorizationUrl: mocks.buildAuthorizationUrl,
  authorizationCodeGrant: mocks.authorizationCodeGrant,
  fetchUserInfo: mocks.fetchUserInfo,
  allowInsecureRequests: vi.fn(),
}));

vi.mock('@ftth-copilot/db', () => ({
  prisma: {
    tenant: { findUnique: mocks.tenantFindUnique },
    tenantPolicy: { findUnique: mocks.tenantPolicyFindUnique },
    userIdentity: { findUnique: mocks.userIdentityFindUnique, create: mocks.userIdentityCreate },
    user: {
      findUnique: mocks.userFindUnique,
      findUniqueOrThrow: mocks.userFindUniqueOrThrow,
      create: mocks.userCreate,
    },
    session: { create: mocks.sessionCreate },
    $transaction: mocks.transaction,
  },
  hashPassword: vi.fn(async () => 'hashed-unusable'),
  verifyPassword: vi.fn(async () => false),
  issueToken: vi.fn((userId: string, tenantId: string, role: string, isTemp = false) => ({
    token: isTemp ? `temp-${userId}` : `jwt-${userId}-${tenantId}-${role}`,
    tokenHash: `hash-${userId}`,
    expiresAt: new Date(Date.now() + 3600_000),
  })),
  verifyToken: vi.fn(),
  hashToken: vi.fn((t: string) => `hash-${t}`),
  COOKIE_NAME: 'ftth_session',
  sessionCookieAttributes: () => ({ path: '/', sameSite: 'lax', secure: false }),
  TOKEN_TTL_SECONDS: 604800,
  checkAuthQuota: vi.fn(async () => ({ allowed: true, retryAfter: 0 })),
  recordAuthAttempt: vi.fn(),
  authRateLimitKeys: mocks.authRateLimitKeys,
  reserveAuthQuota: mocks.reserveAuthQuota,
  releaseAuthQuota: mocks.releaseAuthQuota,
  extractClientIp: mocks.extractClientIp,
  decryptApiKey: vi.fn(),
}));

vi.mock('@ftth-copilot/soc', () => ({
  audit: mocks.audit,
  auditAuth: { login: mocks.auditLogin },
}));

import { GET as oidcLoginGet } from '@/app/api/auth/oidc/login/route';
import { GET as oidcCallbackGet } from '@/app/api/auth/oidc/callback/route';
import { OIDC_TX_COOKIE_NAME, signOidcTxCookie } from '@/lib/auth/oidc';

const ENV_KEYS = [
  'OIDC_ENABLED',
  'OIDC_ISSUER',
  'OIDC_CLIENT_ID',
  'OIDC_CLIENT_SECRET',
  'OIDC_REDIRECT_URI',
  'OIDC_TENANT_SLUG',
  'OIDC_ALLOWED_EMAIL_DOMAINS',
  'OIDC_AUTO_PROVISION',
  'OIDC_ROLE_CLAIM',
  'OIDC_ROLE_MAP',
  'AUTH_RATE_LIMIT_MAX',
  'AUTH_RATE_LIMIT_WINDOW_MS',
] as const;

function setValidOidcEnv(overrides: Record<string, string | undefined> = {}) {
  process.env['OIDC_ENABLED'] = 'true';
  process.env['OIDC_ISSUER'] = 'https://idp.example.com/realms/ftth';
  process.env['OIDC_CLIENT_ID'] = 'ftth-web';
  process.env['OIDC_CLIENT_SECRET'] = 'secret';
  process.env['OIDC_REDIRECT_URI'] = 'http://localhost:3001/api/auth/oidc/callback';
  process.env['OIDC_TENANT_SLUG'] = 'demo-isp';
  process.env['OIDC_ALLOWED_EMAIL_DOMAINS'] = 'example.com';
  process.env['OIDC_AUTO_PROVISION'] = 'false';
  process.env['OIDC_ROLE_CLAIM'] = 'groups';
  process.env['OIDC_ROLE_MAP'] = 'noc-admins:ADMIN,noc-ops:OPERATOR';
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

describe('OIDC API routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.buckets.clear();
    for (const k of ENV_KEYS) delete process.env[k];
    mocks.discovery.mockResolvedValue({ serverMetadata: () => ({}) });
    mocks.tenantFindUnique.mockResolvedValue({ id: 'tenant-1', slug: 'demo-isp' });
    mocks.tenantPolicyFindUnique.mockResolvedValue(null);
    mocks.extractClientIp.mockReturnValue('192.0.2.10');
    mocks.authRateLimitKeys.mockImplementation(
      (email: string | null, ip: string | null, scope: 'login' | 'mfa' | 'oidc' = 'login') => {
        const keys: string[] = [];
        if (email !== null && email.trim().length > 0) {
          keys.push(`${scope}:email:${email.trim().toLowerCase()}`);
        }
        if (ip) keys.push(`${scope}:ip:${ip}`);
        return keys;
      },
    );
    mocks.reserveAuthQuota.mockImplementation(
      async (keys: string[], opts: { max: number; windowMs: number }) => {
        const nowMs = FROZEN_NOW_MS;
        const windowStartMs = computeWindowStartMs(nowMs, opts.windowMs);
        const expiresAt = windowStartMs + opts.windowMs;
        if (keys.length === 0) {
          return { allowed: true, retryAfter: 0, windowStart: new Date(windowStartMs) };
        }
        const uniqueKeys = [...new Set(keys)];
        const blocked = uniqueKeys.some((key) => {
          const existing = mocks.buckets.get(`${key}:${windowStartMs}`);
          return (existing && existing.expiresAt > nowMs ? existing.count : 0) >= opts.max;
        });
        if (blocked) {
          return {
            allowed: false,
            retryAfter: retryAfterSeconds(nowMs, windowStartMs, opts.windowMs),
            windowStart: new Date(windowStartMs),
          };
        }
        for (const key of uniqueKeys) {
          const bucketKey = `${key}:${windowStartMs}`;
          const existing = mocks.buckets.get(bucketKey);
          const count = existing && existing.expiresAt > nowMs ? existing.count + 1 : 1;
          mocks.buckets.set(bucketKey, { count, expiresAt });
        }
        return { allowed: true, retryAfter: 0, windowStart: new Date(windowStartMs) };
      },
    );
    mocks.releaseAuthQuota.mockImplementation(
      async (
        keys: string[],
        opts: { max: number; windowMs: number },
        _store: unknown,
        windowStart: Date = new Date(computeWindowStartMs(FROZEN_NOW_MS, opts.windowMs)),
      ) => {
        const windowStartMs = windowStart.getTime();
        for (const key of keys) {
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
    );
    mocks.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        userIdentity: { create: mocks.userIdentityCreate },
        user: {
          findUniqueOrThrow: mocks.userFindUniqueOrThrow,
          create: mocks.userCreate,
        },
      }),
    );
  });

  it('returns 404 on login and callback when OIDC_ENABLED is false', async () => {
    const loginRes = await oidcLoginGet(new Request('http://localhost:3001/api/auth/oidc/login'));
    const cbRes = await oidcCallbackGet(new Request('http://localhost:3001/api/auth/oidc/callback'));
    expect(loginRes.status).toBe(404);
    expect(cbRes.status).toBe(404);
  });

  it('initiates PKCE Authorization Code flow and sets signed HttpOnly tx cookie', async () => {
    setValidOidcEnv();
    const res = await oidcLoginGet(new Request('http://localhost:3001/api/auth/oidc/login'));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(
      'https://idp.example.com/auth?state=state-123&nonce=nonce-123',
    );
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain(`${OIDC_TX_COOKIE_NAME}=`);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(mocks.buildAuthorizationUrl).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        code_challenge: 'pkce-challenge-123',
        code_challenge_method: 'S256',
        state: 'state-123',
        nonce: 'nonce-123',
      }),
    );
  });

  it('rejects callback when tx cookie is missing', async () => {
    setValidOidcEnv();
    const res = await oidcCallbackGet(
      new Request('http://localhost:3001/api/auth/oidc/callback?code=c1&state=state-123'),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('/login?error=oidc_missing_state');
  });

  it('rejects callback when authorizationCodeGrant fails (e.g. state mismatch)', async () => {
    setValidOidcEnv();
    const txToken = await signOidcTxCookie({
      state: 'state-123',
      nonce: 'nonce-123',
      codeVerifier: 'pkce-verifier-123',
    });
    mocks.authorizationCodeGrant.mockRejectedValueOnce(new Error('unexpected state'));

    const res = await oidcCallbackGet(
      new Request('http://localhost:3001/api/auth/oidc/callback?code=c1&state=wrong', {
        headers: { cookie: `${OIDC_TX_COOKIE_NAME}=${txToken}` },
      }),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('/login?error=oidc_callback_failed');
  });

  it('rejects callback when email_verified is false and audits the rejection', async () => {
    setValidOidcEnv();
    const txToken = await signOidcTxCookie({
      state: 'state-123',
      nonce: 'nonce-123',
      codeVerifier: 'pkce-verifier-123',
    });
    mocks.authorizationCodeGrant.mockResolvedValueOnce({
      claims: () => ({
        sub: 'sub-unverified',
        iss: 'https://idp.example.com/realms/ftth',
        aud: 'ftth-web',
        exp: Math.floor(Date.now() / 1000) + 600,
        nonce: 'nonce-123',
        email: 'alice@example.com',
        email_verified: false,
      }),
      access_token: 'at-1',
    });
    mocks.userIdentityFindUnique.mockResolvedValueOnce(null);

    const res = await oidcCallbackGet(
      new Request('http://localhost:3001/api/auth/oidc/callback?code=c1&state=state-123', {
        headers: { cookie: `${OIDC_TX_COOKIE_NAME}=${txToken}` },
      }),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('/login?error=oidc_email_not_verified');
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      expect.objectContaining({ action: 'oidc login rejected', outcome: 'FAILURE' }),
    );
  });

  it('links existing user in tenant and issues standard session + CSRF cookies', async () => {
    setValidOidcEnv();
    const txToken = await signOidcTxCookie({
      state: 'state-123',
      nonce: 'nonce-123',
      codeVerifier: 'pkce-verifier-123',
    });
    mocks.authorizationCodeGrant.mockResolvedValueOnce({
      claims: () => ({
        sub: 'sub-alice',
        iss: 'https://idp.example.com/realms/ftth',
        aud: 'ftth-web',
        exp: Math.floor(Date.now() / 1000) + 600,
        nonce: 'nonce-123',
        email: 'alice@example.com',
        email_verified: true,
      }),
      access_token: 'at-1',
    });
    mocks.userIdentityFindUnique.mockResolvedValueOnce(null);
    mocks.userFindUnique.mockResolvedValueOnce({ id: 'user-alice' });
    mocks.userIdentityCreate.mockResolvedValueOnce({ id: 'ident-1' });
    mocks.userFindUniqueOrThrow.mockResolvedValueOnce({
      id: 'user-alice',
      email: 'alice@example.com',
      name: 'Alice',
      role: 'ADMIN',
      tenantId: 'tenant-1',
      mfaEnabled: false,
    });

    const res = await oidcCallbackGet(
      new Request('http://localhost:3001/api/auth/oidc/callback?code=c1&state=state-123', {
        headers: { cookie: `${OIDC_TX_COOKIE_NAME}=${txToken}` },
      }),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('http://localhost:3001/app');
    const cookies = res.headers.get('set-cookie') ?? '';
    expect(cookies).toContain('ftth_session=');
    expect(cookies).toContain('ftth_csrf=');
    expect(mocks.sessionCreate).toHaveBeenCalledTimes(1);
    expect(mocks.auditLogin).toHaveBeenCalledTimes(1);
  });

  it('auto-provisions user with mapped role when OIDC_AUTO_PROVISION=true', async () => {
    setValidOidcEnv({ OIDC_AUTO_PROVISION: 'true' });
    const txToken = await signOidcTxCookie({
      state: 'state-123',
      nonce: 'nonce-123',
      codeVerifier: 'pkce-verifier-123',
    });
    mocks.authorizationCodeGrant.mockResolvedValueOnce({
      claims: () => ({
        sub: 'sub-bob',
        iss: 'https://idp.example.com/realms/ftth',
        aud: 'ftth-web',
        exp: Math.floor(Date.now() / 1000) + 600,
        nonce: 'nonce-123',
        email: 'bob@example.com',
        email_verified: true,
        name: 'Bob NOC',
        groups: ['noc-ops', 'noc-admins'],
      }),
      access_token: 'at-1',
    });
    mocks.userIdentityFindUnique.mockResolvedValueOnce(null);
    mocks.userFindUnique.mockResolvedValueOnce(null);
    mocks.userCreate.mockResolvedValueOnce({
      id: 'user-bob',
      email: 'bob@example.com',
      name: 'Bob NOC',
      role: 'ADMIN',
      tenantId: 'tenant-1',
      mfaEnabled: false,
    });

    const res = await oidcCallbackGet(
      new Request('http://localhost:3001/api/auth/oidc/callback?code=c1&state=state-123', {
        headers: { cookie: `${OIDC_TX_COOKIE_NAME}=${txToken}` },
      }),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('http://localhost:3001/app');
    expect(mocks.userCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'bob@example.com',
          role: 'ADMIN',
          tenantId: 'tenant-1',
        }),
      }),
    );
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      expect.objectContaining({ action: 'oidc user provisioned', outcome: 'SUCCESS' }),
    );
  });

  it('redirects to MFA verification when user has mfaEnabled=true', async () => {
    setValidOidcEnv();
    const txToken = await signOidcTxCookie({
      state: 'state-123',
      nonce: 'nonce-123',
      codeVerifier: 'pkce-verifier-123',
    });
    mocks.authorizationCodeGrant.mockResolvedValueOnce({
      claims: () => ({
        sub: 'sub-mfa',
        iss: 'https://idp.example.com/realms/ftth',
        aud: 'ftth-web',
        exp: Math.floor(Date.now() / 1000) + 600,
        nonce: 'nonce-123',
      }),
      access_token: 'at-1',
    });
    mocks.userIdentityFindUnique.mockResolvedValueOnce({
      id: 'ident-mfa',
      userId: 'user-mfa',
      tenantId: 'tenant-1',
    });
    mocks.userFindUnique.mockResolvedValueOnce({
      id: 'user-mfa',
      email: 'mfa@example.com',
      name: 'MFA User',
      role: 'OPERATOR',
      tenantId: 'tenant-1',
      mfaEnabled: true,
      totpSecret: 'enc-totp-secret',
    });

    const res = await oidcCallbackGet(
      new Request('http://localhost:3001/api/auth/oidc/callback?code=c1&state=state-123', {
        headers: { cookie: `${OIDC_TX_COOKIE_NAME}=${txToken}` },
      }),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('/login?mfa=required&tempToken=temp-user-mfa');
    expect(mocks.sessionCreate).not.toHaveBeenCalled();
  });

  it('redirects to MFA enrollment and emits no session when user has mfaEnabled=true without totpSecret even if tenant does not require MFA', async () => {
    setValidOidcEnv();
    mocks.tenantPolicyFindUnique.mockResolvedValueOnce({ requireMfa: false });
    const txToken = await signOidcTxCookie({
      state: 'state-123',
      nonce: 'nonce-123',
      codeVerifier: 'pkce-verifier-123',
    });
    mocks.authorizationCodeGrant.mockResolvedValueOnce({
      claims: () => ({
        sub: 'sub-mfa-corrupt',
        iss: 'https://idp.example.com/realms/ftth',
        aud: 'ftth-web',
        exp: Math.floor(Date.now() / 1000) + 600,
        nonce: 'nonce-123',
      }),
      access_token: 'at-1',
    });
    mocks.userIdentityFindUnique.mockResolvedValueOnce({
      id: 'ident-mfa-corrupt',
      userId: 'user-mfa-corrupt',
      tenantId: 'tenant-1',
    });
    mocks.userFindUnique.mockResolvedValueOnce({
      id: 'user-mfa-corrupt',
      email: 'mfa-corrupt@example.com',
      name: 'Corrupt MFA User',
      role: 'OPERATOR',
      tenantId: 'tenant-1',
      mfaEnabled: true,
      totpSecret: null,
    });

    const res = await oidcCallbackGet(
      new Request('http://localhost:3001/api/auth/oidc/callback?code=c1&state=state-123', {
        headers: { cookie: `${OIDC_TX_COOKIE_NAME}=${txToken}` },
      }),
    );
    expect(res.status).toBe(302);
    const location = res.headers.get('location') ?? '';
    expect(location).toContain('/login?mfa=setup_required&tempToken=temp-user-mfa-corrupt');
    expect(location).not.toContain('mfa=required');
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).not.toContain('ftth_session=');
    expect(mocks.sessionCreate).not.toHaveBeenCalled();
  });

  it('rate-limits repeated failed code exchanges from the same IP with 429 and retry-after', async () => {
    setValidOidcEnv({ AUTH_RATE_LIMIT_MAX: '3', AUTH_RATE_LIMIT_WINDOW_MS: '900000' });
    mocks.extractClientIp.mockReturnValue('198.51.100.42');
    const txToken = await signOidcTxCookie({
      state: 'state-123',
      nonce: 'nonce-123',
      codeVerifier: 'pkce-verifier-123',
    });

    for (let i = 0; i < 3; i++) {
      mocks.authorizationCodeGrant.mockRejectedValueOnce(new Error('invalid_grant'));
      const res = await oidcCallbackGet(
        new Request('http://localhost:3001/api/auth/oidc/callback?code=bad&state=state-123', {
          headers: {
            cookie: `${OIDC_TX_COOKIE_NAME}=${txToken}`,
            'x-forwarded-for': '198.51.100.42',
          },
        }),
      );
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toContain('/login?error=oidc_callback_failed');
    }

    const blocked = await oidcCallbackGet(
      new Request('http://localhost:3001/api/auth/oidc/callback?code=bad&state=state-123', {
        headers: {
          cookie: `${OIDC_TX_COOKIE_NAME}=${txToken}`,
          'x-forwarded-for': '198.51.100.42',
        },
      }),
    );
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(mocks.authorizationCodeGrant).toHaveBeenCalledTimes(3);
    expect(mocks.sessionCreate).not.toHaveBeenCalled();
    const windowStartMs = computeWindowStartMs(FROZEN_NOW_MS, 900_000);
    expect(mocks.buckets.get(`oidc:ip:198.51.100.42:${windowStartMs}`)?.count).toBe(3);
  });

  it('charges callback rejections after identity resolution to oidc:email: and blocks on 429', async () => {
    setValidOidcEnv({ AUTH_RATE_LIMIT_MAX: '2', AUTH_RATE_LIMIT_WINDOW_MS: '900000' });
    const txToken = await signOidcTxCookie({
      state: 'state-123',
      nonce: 'nonce-123',
      codeVerifier: 'pkce-verifier-123',
    });

    for (let i = 0; i < 2; i++) {
      mocks.extractClientIp.mockReturnValueOnce(`203.0.113.${10 + i}`);
      mocks.authorizationCodeGrant.mockResolvedValueOnce({
        claims: () => ({
          sub: `sub-evil-${i}`,
          iss: 'https://idp.example.com/realms/ftth',
          aud: 'ftth-web',
          exp: Math.floor(Date.now() / 1000) + 600,
          nonce: 'nonce-123',
          email: 'attacker@untrusted.example',
          email_verified: true,
        }),
        access_token: 'at-1',
      });
      mocks.userIdentityFindUnique.mockResolvedValueOnce(null);
      mocks.userFindUnique.mockResolvedValueOnce(null);

      const res = await oidcCallbackGet(
        new Request('http://localhost:3001/api/auth/oidc/callback?code=c1&state=state-123', {
          headers: { cookie: `${OIDC_TX_COOKIE_NAME}=${txToken}` },
        }),
      );
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toContain('/login?error=oidc_domain_not_allowed');
    }

    mocks.extractClientIp.mockReturnValueOnce('203.0.113.99');
    mocks.authorizationCodeGrant.mockResolvedValueOnce({
      claims: () => ({
        sub: 'sub-evil-2',
        iss: 'https://idp.example.com/realms/ftth',
        aud: 'ftth-web',
        exp: Math.floor(Date.now() / 1000) + 600,
        nonce: 'nonce-123',
        email: 'attacker@untrusted.example',
        email_verified: true,
      }),
      access_token: 'at-1',
    });
    mocks.userIdentityFindUnique.mockResolvedValueOnce(null);

    const blocked = await oidcCallbackGet(
      new Request('http://localhost:3001/api/auth/oidc/callback?code=c1&state=state-123', {
        headers: { cookie: `${OIDC_TX_COOKIE_NAME}=${txToken}` },
      }),
    );
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(mocks.sessionCreate).not.toHaveBeenCalled();
    const windowStartMs = computeWindowStartMs(FROZEN_NOW_MS, 900_000);
    expect(
      mocks.buckets.get(`oidc:email:attacker@untrusted.example:${windowStartMs}`)?.count,
    ).toBe(2);
    expect(mocks.buckets.get(`oidc:ip:203.0.113.99:${windowStartMs}`)?.count).toBe(1);
  });

  it('requires MFA enrollment and emits no session when tenant requires MFA and user has no TOTP', async () => {
    setValidOidcEnv();
    mocks.tenantPolicyFindUnique.mockResolvedValueOnce({ requireMfa: true });
    const txToken = await signOidcTxCookie({
      state: 'state-123',
      nonce: 'nonce-123',
      codeVerifier: 'pkce-verifier-123',
    });
    mocks.authorizationCodeGrant.mockResolvedValueOnce({
      claims: () => ({
        sub: 'sub-nomfa',
        iss: 'https://idp.example.com/realms/ftth',
        aud: 'ftth-web',
        exp: Math.floor(Date.now() / 1000) + 600,
        nonce: 'nonce-123',
        email: 'nomfa@example.com',
        email_verified: true,
      }),
      access_token: 'at-1',
    });
    mocks.userIdentityFindUnique.mockResolvedValueOnce({
      id: 'ident-nomfa',
      userId: 'user-nomfa',
      tenantId: 'tenant-1',
    });
    const noMfaUser = {
      id: 'user-nomfa',
      email: 'nomfa@example.com',
      name: 'No MFA User',
      role: 'OPERATOR',
      tenantId: 'tenant-1',
      mfaEnabled: false,
      totpSecret: null,
    };
    mocks.userFindUnique
      .mockResolvedValueOnce({ id: 'user-nomfa' })
      .mockResolvedValueOnce(noMfaUser);

    const res = await oidcCallbackGet(
      new Request('http://localhost:3001/api/auth/oidc/callback?code=c1&state=state-123', {
        headers: { cookie: `${OIDC_TX_COOKIE_NAME}=${txToken}` },
      }),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain(
      '/login?mfa=setup_required&tempToken=temp-user-nomfa',
    );
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).not.toContain('ftth_session=');
    expect(mocks.sessionCreate).not.toHaveBeenCalled();
  });

  it('redirects with tempToken and emits no session when tenant requires MFA and user has TOTP', async () => {
    setValidOidcEnv();
    mocks.tenantPolicyFindUnique.mockResolvedValueOnce({ requireMfa: true });
    const txToken = await signOidcTxCookie({
      state: 'state-123',
      nonce: 'nonce-123',
      codeVerifier: 'pkce-verifier-123',
    });
    mocks.authorizationCodeGrant.mockResolvedValueOnce({
      claims: () => ({
        sub: 'sub-mfa-policy',
        iss: 'https://idp.example.com/realms/ftth',
        aud: 'ftth-web',
        exp: Math.floor(Date.now() / 1000) + 600,
        nonce: 'nonce-123',
      }),
      access_token: 'at-1',
    });
    mocks.userIdentityFindUnique.mockResolvedValueOnce({
      id: 'ident-mfa-p',
      userId: 'user-mfa-p',
      tenantId: 'tenant-1',
    });
    mocks.userFindUnique.mockResolvedValueOnce({
      id: 'user-mfa-p',
      email: 'mfa-policy@example.com',
      name: 'MFA Policy User',
      role: 'ADMIN',
      tenantId: 'tenant-1',
      mfaEnabled: true,
      totpSecret: 'enc-totp-secret',
    });

    const res = await oidcCallbackGet(
      new Request('http://localhost:3001/api/auth/oidc/callback?code=c1&state=state-123', {
        headers: { cookie: `${OIDC_TX_COOKIE_NAME}=${txToken}` },
      }),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain(
      '/login?mfa=required&tempToken=temp-user-mfa-p',
    );
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).not.toContain('ftth_session=');
    expect(mocks.sessionCreate).not.toHaveBeenCalled();
  });

  it('issues session and refunds quota when tenant does not require MFA and user has no TOTP', async () => {
    setValidOidcEnv({ AUTH_RATE_LIMIT_MAX: '2', AUTH_RATE_LIMIT_WINDOW_MS: '900000' });
    mocks.tenantPolicyFindUnique.mockResolvedValueOnce({ requireMfa: false });
    const txToken = await signOidcTxCookie({
      state: 'state-123',
      nonce: 'nonce-123',
      codeVerifier: 'pkce-verifier-123',
    });
    mocks.authorizationCodeGrant.mockResolvedValueOnce({
      claims: () => ({
        sub: 'sub-ok',
        iss: 'https://idp.example.com/realms/ftth',
        aud: 'ftth-web',
        exp: Math.floor(Date.now() / 1000) + 600,
        nonce: 'nonce-123',
        email: 'ok@example.com',
        email_verified: true,
      }),
      access_token: 'at-1',
    });
    mocks.userIdentityFindUnique.mockResolvedValueOnce({
      id: 'ident-ok',
      userId: 'user-ok',
      tenantId: 'tenant-1',
    });
    const okUser = {
      id: 'user-ok',
      email: 'ok@example.com',
      name: 'OK User',
      role: 'MEMBER',
      tenantId: 'tenant-1',
      mfaEnabled: false,
      totpSecret: null,
    };
    mocks.userFindUnique
      .mockResolvedValueOnce({ id: 'user-ok' })
      .mockResolvedValueOnce(okUser);

    const res = await oidcCallbackGet(
      new Request('http://localhost:3001/api/auth/oidc/callback?code=c1&state=state-123', {
        headers: { cookie: `${OIDC_TX_COOKIE_NAME}=${txToken}` },
      }),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('http://localhost:3001/app');
    const cookies = res.headers.get('set-cookie') ?? '';
    expect(cookies).toContain('ftth_session=');
    expect(mocks.sessionCreate).toHaveBeenCalledTimes(1);

    // Refunded: every oidc bucket created during the callback is back at 0
    for (const [bucketKey, bucket] of mocks.buckets.entries()) {
      expect(bucketKey).toMatch(/^oidc:/);
      expect(bucket.count).toBe(0);
    }
  });

  it('uses oidc: keys isolated from login: and mfa: buckets', async () => {
    setValidOidcEnv({ AUTH_RATE_LIMIT_MAX: '1', AUTH_RATE_LIMIT_WINDOW_MS: '900000' });
    const windowStartMs = computeWindowStartMs(FROZEN_NOW_MS, 900_000);
    const expiresAt = windowStartMs + 900_000;
    mocks.buckets.set(`login:ip:192.0.2.10:${windowStartMs}`, { count: 99, expiresAt });
    mocks.buckets.set(`login:email:isolated@example.com:${windowStartMs}`, { count: 99, expiresAt });
    mocks.buckets.set(`mfa:ip:192.0.2.10:${windowStartMs}`, { count: 99, expiresAt });
    mocks.buckets.set(`mfa:email:isolated@example.com:${windowStartMs}`, { count: 99, expiresAt });

    const txToken = await signOidcTxCookie({
      state: 'state-123',
      nonce: 'nonce-123',
      codeVerifier: 'pkce-verifier-123',
    });
    mocks.authorizationCodeGrant.mockResolvedValueOnce({
      claims: () => ({
        sub: 'sub-iso',
        iss: 'https://idp.example.com/realms/ftth',
        aud: 'ftth-web',
        exp: Math.floor(Date.now() / 1000) + 600,
        nonce: 'nonce-123',
        email: 'isolated@example.com',
        email_verified: true,
      }),
      access_token: 'at-1',
    });
    mocks.userIdentityFindUnique.mockResolvedValueOnce({
      id: 'ident-iso',
      userId: 'user-iso',
      tenantId: 'tenant-1',
    });
    const isoUser = {
      id: 'user-iso',
      email: 'isolated@example.com',
      name: 'Isolated User',
      role: 'MEMBER',
      tenantId: 'tenant-1',
      mfaEnabled: false,
      totpSecret: null,
    };
    mocks.userFindUnique
      .mockResolvedValueOnce({ id: 'user-iso' })
      .mockResolvedValueOnce(isoUser);

    const res = await oidcCallbackGet(
      new Request('http://localhost:3001/api/auth/oidc/callback?code=c1&state=state-123', {
        headers: { cookie: `${OIDC_TX_COOKIE_NAME}=${txToken}` },
      }),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('http://localhost:3001/app');
    expect(mocks.authRateLimitKeys).toHaveBeenCalledWith(null, '192.0.2.10', 'oidc');
    expect(mocks.authRateLimitKeys).toHaveBeenCalledWith('isolated@example.com', null, 'oidc');
    expect(mocks.buckets.get(`login:ip:192.0.2.10:${windowStartMs}`)?.count).toBe(99);
    expect(mocks.buckets.get(`mfa:email:isolated@example.com:${windowStartMs}`)?.count).toBe(99);
  });
});
