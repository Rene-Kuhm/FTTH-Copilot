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
  extractClientIp: vi.fn((_xForwardedFor?: string | null): string | null => '192.0.2.10'),
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

const { authRateLimitKeys: realAuthRateLimitKeys } =
  await vi.importActual<typeof import('@ftth-copilot/db')>('@ftth-copilot/db');

/** Bucket por transacción OIDC: `oidc:tx:<hash>` (nunca el bucket compartido `oidc:ip:unknown`). */
const txKeyOf = (token: string): string => realAuthRateLimitKeys(null, null, 'oidc', token)[0];

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
    mocks.authRateLimitKeys.mockImplementation(realAuthRateLimitKeys);
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
    // La reserva por IP se reembolsa cuando la reserva por email es denegada.
    expect(mocks.buckets.get(`oidc:ip:203.0.113.99:${windowStartMs}`)?.count).toBe(0);
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

  it('refunds reserved IP and email quotas and returns 500 on unexpected error during user or MFA policy lookup', async () => {
    setValidOidcEnv({ AUTH_RATE_LIMIT_MAX: '2', AUTH_RATE_LIMIT_WINDOW_MS: '900000' });
    mocks.extractClientIp.mockReturnValue('198.51.100.77');
    const windowStartMs = computeWindowStartMs(FROZEN_NOW_MS, 900_000);
    const txToken = await signOidcTxCookie({
      state: 'state-123',
      nonce: 'nonce-123',
      codeVerifier: 'pkce-verifier-123',
    });

    // Case 1: unexpected DB error during user lookup after IP + email reservation
    mocks.authorizationCodeGrant.mockResolvedValueOnce({
      claims: () => ({
        sub: 'sub-err-1',
        iss: 'https://idp.example.com/realms/ftth',
        aud: 'ftth-web',
        exp: Math.floor(Date.now() / 1000) + 600,
        nonce: 'nonce-123',
        email: 'db-err@example.com',
        email_verified: true,
      }),
      access_token: 'at-1',
    });
    mocks.userIdentityFindUnique.mockResolvedValueOnce(null);
    mocks.userFindUnique.mockRejectedValueOnce(new Error('transient DB error'));

    const dbErrRes = await oidcCallbackGet(
      new Request('http://localhost:3001/api/auth/oidc/callback?code=c1&state=state-123', {
        headers: {
          cookie: `${OIDC_TX_COOKIE_NAME}=${txToken}`,
          'x-forwarded-for': '198.51.100.77',
        },
      }),
    );
    expect(dbErrRes.status).toBe(500);
    expect(mocks.sessionCreate).not.toHaveBeenCalled();
    expect(mocks.buckets.get(`oidc:ip:198.51.100.77:${windowStartMs}`)?.count).toBe(0);
    expect(mocks.buckets.get(`oidc:email:db-err@example.com:${windowStartMs}`)?.count).toBe(0);

    // Case 2: unexpected error during tenant MFA policy evaluation after IP + email reservation
    mocks.authorizationCodeGrant.mockResolvedValueOnce({
      claims: () => ({
        sub: 'sub-err-2',
        iss: 'https://idp.example.com/realms/ftth',
        aud: 'ftth-web',
        exp: Math.floor(Date.now() / 1000) + 600,
        nonce: 'nonce-123',
        email: 'mfa-err@example.com',
        email_verified: true,
      }),
      access_token: 'at-1',
    });
    mocks.userIdentityFindUnique.mockResolvedValueOnce({
      id: 'ident-err-2',
      userId: 'user-err-2',
      tenantId: 'tenant-1',
    });
    mocks.userFindUnique
      .mockResolvedValueOnce({ id: 'user-err-2' })
      .mockResolvedValueOnce({
        id: 'user-err-2',
        email: 'mfa-err@example.com',
        name: 'MFA Err User',
        role: 'OPERATOR',
        tenantId: 'tenant-1',
        mfaEnabled: false,
        totpSecret: null,
      });
    mocks.tenantPolicyFindUnique.mockRejectedValueOnce(new Error('MFA policy lookup failed'));

    const mfaErrRes = await oidcCallbackGet(
      new Request('http://localhost:3001/api/auth/oidc/callback?code=c1&state=state-123', {
        headers: {
          cookie: `${OIDC_TX_COOKIE_NAME}=${txToken}`,
          'x-forwarded-for': '198.51.100.77',
        },
      }),
    );
    expect(mfaErrRes.status).toBe(500);
    expect(mocks.sessionCreate).not.toHaveBeenCalled();
    expect(mocks.buckets.get(`oidc:ip:198.51.100.77:${windowStartMs}`)?.count).toBe(0);
    expect(mocks.buckets.get(`oidc:email:mfa-err@example.com:${windowStartMs}`)?.count).toBe(0);

    // Case 3: unexpected error after IP reservation but before email resolution (only IP reserved)
    mocks.authorizationCodeGrant.mockResolvedValueOnce({
      claims: () => ({
        sub: 'sub-err-3',
        iss: 'https://idp.example.com/realms/ftth',
        aud: 'ftth-web',
        exp: Math.floor(Date.now() / 1000) + 600,
        nonce: 'nonce-123',
      }),
      access_token: 'at-1',
    });
    mocks.tenantFindUnique.mockRejectedValueOnce(new Error('tenant query failed'));

    const ipOnlyErrRes = await oidcCallbackGet(
      new Request('http://localhost:3001/api/auth/oidc/callback?code=c1&state=state-123', {
        headers: {
          cookie: `${OIDC_TX_COOKIE_NAME}=${txToken}`,
          'x-forwarded-for': '198.51.100.77',
        },
      }),
    );
    expect(ipOnlyErrRes.status).toBe(500);
    expect(mocks.sessionCreate).not.toHaveBeenCalled();
    expect(mocks.buckets.get(`oidc:ip:198.51.100.77:${windowStartMs}`)?.count).toBe(0);
  });

  it('charges oidc:tx:<hash> bucket per transaction when X-Forwarded-For is absent and enforces AUTH_RATE_LIMIT_MAX', async () => {
    setValidOidcEnv({
      AUTH_RATE_LIMIT_MAX: '2',
      AUTH_RATE_LIMIT_WINDOW_MS: '900000',
    });
    mocks.extractClientIp.mockImplementation((xff: string | null | undefined) => {
      if (!xff) return null;
      const first = xff.split(',')[0]?.trim();
      return first && first.length > 0 ? first : null;
    });
    const windowStartMs = computeWindowStartMs(FROZEN_NOW_MS, 900_000);
    const txToken = await signOidcTxCookie({
      state: 'state-123',
      nonce: 'nonce-123',
      codeVerifier: 'pkce-verifier-123',
    });
    const txKey = txKeyOf(txToken);

    for (let i = 0; i < 2; i++) {
      mocks.authorizationCodeGrant.mockRejectedValueOnce(new Error('invalid_grant'));
      const res = await oidcCallbackGet(
        new Request('http://localhost:3001/api/auth/oidc/callback?code=bad&state=state-123', {
          headers: {
            cookie: `${OIDC_TX_COOKIE_NAME}=${txToken}`,
          },
        }),
      );
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toContain('/login?error=oidc_callback_failed');
    }

    expect(mocks.extractClientIp).toHaveBeenCalledWith(null);
    expect(mocks.buckets.has(`oidc:ip:unknown:${windowStartMs}`)).toBe(false);
    expect(mocks.buckets.get(`${txKey}:${windowStartMs}`)?.count).toBe(2);

    const blocked = await oidcCallbackGet(
      new Request('http://localhost:3001/api/auth/oidc/callback?code=bad&state=state-123', {
        headers: {
          cookie: `${OIDC_TX_COOKIE_NAME}=${txToken}`,
        },
      }),
    );
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(mocks.authorizationCodeGrant).toHaveBeenCalledTimes(2);
    expect(mocks.buckets.get(`${txKey}:${windowStartMs}`)?.count).toBe(2);

    // El bucket es por transacción: otra transacción OIDC no comparte el presupuesto agotado.
    const otherTxToken = await signOidcTxCookie({ state: 'state-456', nonce: 'nonce-123', codeVerifier: 'pkce-verifier-456' });
    mocks.authorizationCodeGrant.mockRejectedValueOnce(new Error('invalid_grant'));
    const isolated = await oidcCallbackGet(
      new Request('http://localhost:3001/api/auth/oidc/callback?code=bad&state=state-123', {
        headers: { cookie: `${OIDC_TX_COOKIE_NAME}=${otherTxToken}` },
      }),
    );
    expect(isolated.status).toBe(302);
    expect(mocks.buckets.get(`${txKeyOf(otherTxToken)}:${windowStartMs}`)?.count).toBe(1);
  });

  it('enforces strict AUTH_RATE_LIMIT_MAX on oidc:ip:<ip> when X-Forwarded-For is present without touching oidc:tx: or oidc:ip:unknown', async () => {
    setValidOidcEnv({
      AUTH_RATE_LIMIT_MAX: '1',
      AUTH_RATE_LIMIT_WINDOW_MS: '900000',
    });
    mocks.extractClientIp.mockImplementation((xff: string | null | undefined) => {
      if (!xff) return null;
      const first = xff.split(',')[0]?.trim();
      return first && first.length > 0 ? first : null;
    });
    const windowStartMs = computeWindowStartMs(FROZEN_NOW_MS, 900_000);
    const txToken = await signOidcTxCookie({
      state: 'state-123',
      nonce: 'nonce-123',
      codeVerifier: 'pkce-verifier-123',
    });

    mocks.authorizationCodeGrant.mockRejectedValueOnce(new Error('invalid_grant'));
    const first = await oidcCallbackGet(
      new Request('http://localhost:3001/api/auth/oidc/callback?code=bad&state=state-123', {
        headers: {
          cookie: `${OIDC_TX_COOKIE_NAME}=${txToken}`,
          'x-forwarded-for': '198.51.100.88',
        },
      }),
    );
    expect(first.status).toBe(302);
    expect(mocks.buckets.get(`oidc:ip:198.51.100.88:${windowStartMs}`)?.count).toBe(1);
    expect(mocks.buckets.has(`oidc:ip:unknown:${windowStartMs}`)).toBe(false);
    expect(mocks.buckets.has(`${txKeyOf(txToken)}:${windowStartMs}`)).toBe(false);

    const blocked = await oidcCallbackGet(
      new Request('http://localhost:3001/api/auth/oidc/callback?code=bad&state=state-123', {
        headers: {
          cookie: `${OIDC_TX_COOKIE_NAME}=${txToken}`,
          'x-forwarded-for': '198.51.100.88',
        },
      }),
    );
    expect(blocked.status).toBe(429);
    expect(mocks.buckets.has(`oidc:ip:unknown:${windowStartMs}`)).toBe(false);
  });

  it('refunds the prior tx or IP reservation when the oidc:email: reservation is denied', async () => {
    setValidOidcEnv({
      AUTH_RATE_LIMIT_MAX: '1',
      AUTH_RATE_LIMIT_WINDOW_MS: '900000',
    });
    mocks.extractClientIp.mockImplementation((xff: string | null | undefined) => {
      if (!xff) return null;
      const first = xff.split(',')[0]?.trim();
      return first && first.length > 0 ? first : null;
    });
    const windowStartMs = computeWindowStartMs(FROZEN_NOW_MS, 900_000);
    const txToken = await signOidcTxCookie({
      state: 'state-123',
      nonce: 'nonce-123',
      codeVerifier: 'pkce-verifier-123',
    });
    const txToken2 = await signOidcTxCookie({ state: 'state-456', nonce: 'nonce-123', codeVerifier: 'pkce-verifier-456' });

    for (let i = 0; i < 2; i++) {
      mocks.authorizationCodeGrant.mockResolvedValueOnce({
        claims: () => ({
          sub: `sub-unk-email-${i}`,
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
      if (i === 0) {
        mocks.userFindUnique.mockResolvedValueOnce(null);
      }
    }

    const first = await oidcCallbackGet(
      new Request('http://localhost:3001/api/auth/oidc/callback?code=c1&state=state-123', {
        headers: { cookie: `${OIDC_TX_COOKIE_NAME}=${txToken}` },
      }),
    );
    expect(first.status).toBe(302);
    expect(first.headers.get('location')).toContain('/login?error=oidc_domain_not_allowed');

    const second = await oidcCallbackGet(
      new Request('http://localhost:3001/api/auth/oidc/callback?code=c1&state=state-123', {
        headers: { cookie: `${OIDC_TX_COOKIE_NAME}=${txToken2}` },
      }),
    );
    expect(second.status).toBe(429);
    // La reserva por tx previa se reembolsa cuando la reserva por email es denegada.
    expect(mocks.buckets.get(`${txKeyOf(txToken2)}:${windowStartMs}`)?.count).toBe(0);
    expect(
      mocks.buckets.get(`oidc:email:attacker@untrusted.example:${windowStartMs}`)?.count,
    ).toBe(1);

    // Sitio 2 de reserva de email: el email sale del userRecord cuando el claim no lo trae.
    mocks.authorizationCodeGrant.mockResolvedValueOnce({
      claims: () => ({ sub: 'sub-unk-email-2', iss: 'https://idp.example.com/realms/ftth', aud: 'ftth-web', exp: Math.floor(Date.now() / 1000) + 600, nonce: 'nonce-123' }),
      access_token: 'at-1',
    });
    mocks.userIdentityFindUnique.mockResolvedValueOnce({ id: 'ident-2', userId: 'user-2', tenantId: 'tenant-1' });
    mocks.userFindUnique.mockResolvedValueOnce({ id: 'user-2', email: 'attacker@untrusted.example', name: 'Sin Email', role: 'MEMBER', tenantId: 'tenant-1', mfaEnabled: false, totpSecret: null });
    const third = await oidcCallbackGet(
      new Request('http://localhost:3001/api/auth/oidc/callback?code=c1&state=state-123', {
        headers: { cookie: `${OIDC_TX_COOKIE_NAME}=${txToken2}` },
      }),
    );
    expect(third.status).toBe(429);
    expect(mocks.buckets.get(`${txKeyOf(txToken2)}:${windowStartMs}`)?.count).toBe(0);
  });

  it('refunds oidc:tx:<hash> and oidc:email: with each bucket reservation windowStart on success and MFA delegation', async () => {
    setValidOidcEnv({
      AUTH_RATE_LIMIT_MAX: '2',
      AUTH_RATE_LIMIT_WINDOW_MS: '900000',
    });
    mocks.extractClientIp.mockImplementation((xff: string | null | undefined) => {
      if (!xff) return null;
      const first = xff.split(',')[0]?.trim();
      return first && first.length > 0 ? first : null;
    });
    const windowStartMs = computeWindowStartMs(FROZEN_NOW_MS, 900_000);
    const nextWindowStartMs = windowStartMs + 900_000;
    const txToken = await signOidcTxCookie({
      state: 'state-123',
      nonce: 'nonce-123',
      codeVerifier: 'pkce-verifier-123',
    });
    const txKey = txKeyOf(txToken);

    // Case 1: successful login without X-Forwarded-For across a window rollover between IP and email reservations
    const defaultReserveImpl = mocks.reserveAuthQuota.getMockImplementation()!;
    mocks.reserveAuthQuota
      .mockImplementationOnce(async (keys: string[], opts: { max: number; windowMs: number }) => {
        for (const key of keys) {
          mocks.buckets.set(`${key}:${windowStartMs}`, {
            count: 1,
            expiresAt: windowStartMs + opts.windowMs,
          });
        }
        return { allowed: true, retryAfter: 0, windowStart: new Date(windowStartMs) };
      })
      .mockImplementationOnce(async (keys: string[], opts: { max: number; windowMs: number }) => {
        for (const key of keys) {
          mocks.buckets.set(`${key}:${nextWindowStartMs}`, {
            count: 1,
            expiresAt: nextWindowStartMs + opts.windowMs,
          });
        }
        return { allowed: true, retryAfter: 0, windowStart: new Date(nextWindowStartMs) };
      });

    mocks.tenantPolicyFindUnique.mockResolvedValueOnce({ requireMfa: false });
    mocks.authorizationCodeGrant.mockResolvedValueOnce({
      claims: () => ({
        sub: 'sub-ok-unknown',
        iss: 'https://idp.example.com/realms/ftth',
        aud: 'ftth-web',
        exp: Math.floor(Date.now() / 1000) + 600,
        nonce: 'nonce-123',
        email: 'ok-unknown@example.com',
        email_verified: true,
      }),
      access_token: 'at-1',
    });
    mocks.userIdentityFindUnique.mockResolvedValueOnce({
      id: 'ident-ok-unknown',
      userId: 'user-ok-unknown',
      tenantId: 'tenant-1',
    });
    mocks.userFindUnique
      .mockResolvedValueOnce({ id: 'user-ok-unknown' })
      .mockResolvedValueOnce({
        id: 'user-ok-unknown',
        email: 'ok-unknown@example.com',
        name: 'OK Unknown IP',
        role: 'MEMBER',
        tenantId: 'tenant-1',
        mfaEnabled: false,
        totpSecret: null,
      });

    const okRes = await oidcCallbackGet(
      new Request('http://localhost:3001/api/auth/oidc/callback?code=c1&state=state-123', {
        headers: { cookie: `${OIDC_TX_COOKIE_NAME}=${txToken}` },
      }),
    );
    expect(okRes.status).toBe(302);
    expect(okRes.headers.get('location')).toBe('http://localhost:3001/app');
    expect(mocks.buckets.get(`${txKey}:${windowStartMs}`)?.count).toBe(0);
    expect(mocks.buckets.get(`oidc:email:ok-unknown@example.com:${nextWindowStartMs}`)?.count).toBe(0);

    // Case 2: MFA delegation without X-Forwarded-For
    mocks.reserveAuthQuota.mockImplementation(defaultReserveImpl);
    mocks.tenantPolicyFindUnique.mockResolvedValueOnce({ requireMfa: false });
    mocks.authorizationCodeGrant.mockResolvedValueOnce({
      claims: () => ({
        sub: 'sub-mfa-unknown',
        iss: 'https://idp.example.com/realms/ftth',
        aud: 'ftth-web',
        exp: Math.floor(Date.now() / 1000) + 600,
        nonce: 'nonce-123',
        email: 'mfa-unknown@example.com',
        email_verified: true,
      }),
      access_token: 'at-1',
    });
    mocks.userIdentityFindUnique.mockResolvedValueOnce({
      id: 'ident-mfa-unknown',
      userId: 'user-mfa-unknown',
      tenantId: 'tenant-1',
    });
    mocks.userFindUnique
      .mockResolvedValueOnce({ id: 'user-mfa-unknown' })
      .mockResolvedValueOnce({
        id: 'user-mfa-unknown',
        email: 'mfa-unknown@example.com',
        name: 'MFA Unknown IP',
        role: 'OPERATOR',
        tenantId: 'tenant-1',
        mfaEnabled: true,
        totpSecret: 'enc-totp-secret',
      });

    const mfaRes = await oidcCallbackGet(
      new Request('http://localhost:3001/api/auth/oidc/callback?code=c1&state=state-123', {
        headers: { cookie: `${OIDC_TX_COOKIE_NAME}=${txToken}` },
      }),
    );
    expect(mfaRes.status).toBe(302);
    expect(mfaRes.headers.get('location')).toContain(
      '/login?mfa=required&tempToken=temp-user-mfa-unknown',
    );
    expect(mocks.buckets.get(`${txKey}:${windowStartMs}`)?.count).toBe(0);
    expect(mocks.buckets.get(`oidc:email:mfa-unknown@example.com:${windowStartMs}`)?.count).toBe(0);
  });

  it('keeps oidc:ip: consumed (not refunded) on invalid code exchange when X-Forwarded-For is present', async () => {
    setValidOidcEnv({ AUTH_RATE_LIMIT_MAX: '3', AUTH_RATE_LIMIT_WINDOW_MS: '900000' });
    mocks.extractClientIp.mockReturnValueOnce('198.51.100.55');
    const windowStartMs = computeWindowStartMs(FROZEN_NOW_MS, 900_000);
    const txToken = await signOidcTxCookie({
      state: 'state-123',
      nonce: 'nonce-123',
      codeVerifier: 'pkce-verifier-123',
    });
    mocks.authorizationCodeGrant.mockRejectedValueOnce(new Error('invalid_grant'));

    const res = await oidcCallbackGet(
      new Request('http://localhost:3001/api/auth/oidc/callback?code=bad&state=state-123', {
        headers: {
          cookie: `${OIDC_TX_COOKIE_NAME}=${txToken}`,
          'x-forwarded-for': '198.51.100.55',
        },
      }),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('/login?error=oidc_callback_failed');
    expect(mocks.buckets.get(`oidc:ip:198.51.100.55:${windowStartMs}`)?.count).toBe(1);
    expect([...mocks.buckets.keys()].some((k) => k.startsWith('oidc:email:'))).toBe(false);
  });

  it('keeps oidc:email: and oidc:ip: consumed (not refunded) on post-email rejections (domain_not_allowed and user_not_found)', async () => {
    setValidOidcEnv({ AUTH_RATE_LIMIT_MAX: '5', AUTH_RATE_LIMIT_WINDOW_MS: '900000' });
    const windowStartMs = computeWindowStartMs(FROZEN_NOW_MS, 900_000);
    const txToken = await signOidcTxCookie({
      state: 'state-123',
      nonce: 'nonce-123',
      codeVerifier: 'pkce-verifier-123',
    });

    // Domain not allowed
    mocks.extractClientIp.mockReturnValueOnce('198.51.100.61');
    mocks.authorizationCodeGrant.mockResolvedValueOnce({
      claims: () => ({
        sub: 'sub-bad-domain',
        iss: 'https://idp.example.com/realms/ftth',
        aud: 'ftth-web',
        exp: Math.floor(Date.now() / 1000) + 600,
        nonce: 'nonce-123',
        email: 'outsider@forbidden.example',
        email_verified: true,
      }),
      access_token: 'at-1',
    });
    mocks.userIdentityFindUnique.mockResolvedValueOnce(null);
    mocks.userFindUnique.mockResolvedValueOnce(null);

    const domainRes = await oidcCallbackGet(
      new Request('http://localhost:3001/api/auth/oidc/callback?code=c1&state=state-123', {
        headers: {
          cookie: `${OIDC_TX_COOKIE_NAME}=${txToken}`,
          'x-forwarded-for': '198.51.100.61',
        },
      }),
    );
    expect(domainRes.status).toBe(302);
    expect(domainRes.headers.get('location')).toContain('/login?error=oidc_domain_not_allowed');
    expect(mocks.buckets.get(`oidc:ip:198.51.100.61:${windowStartMs}`)?.count).toBe(1);
    expect(
      mocks.buckets.get(`oidc:email:outsider@forbidden.example:${windowStartMs}`)?.count,
    ).toBe(1);

    // User not found (allowed domain, autoProvision=false, no existing user)
    mocks.extractClientIp.mockReturnValueOnce('198.51.100.62');
    mocks.authorizationCodeGrant.mockResolvedValueOnce({
      claims: () => ({
        sub: 'sub-missing-user',
        iss: 'https://idp.example.com/realms/ftth',
        aud: 'ftth-web',
        exp: Math.floor(Date.now() / 1000) + 600,
        nonce: 'nonce-123',
        email: 'nobody@example.com',
        email_verified: true,
      }),
      access_token: 'at-1',
    });
    mocks.userIdentityFindUnique.mockResolvedValueOnce(null);
    mocks.userFindUnique.mockResolvedValueOnce(null);

    const userNotFoundRes = await oidcCallbackGet(
      new Request('http://localhost:3001/api/auth/oidc/callback?code=c1&state=state-123', {
        headers: {
          cookie: `${OIDC_TX_COOKIE_NAME}=${txToken}`,
          'x-forwarded-for': '198.51.100.62',
        },
      }),
    );
    expect(userNotFoundRes.status).toBe(302);
    expect(userNotFoundRes.headers.get('location')).toContain('/login?error=oidc_user_not_found');
    expect(mocks.buckets.get(`oidc:ip:198.51.100.62:${windowStartMs}`)?.count).toBe(1);
    expect(mocks.buckets.get(`oidc:email:nobody@example.com:${windowStartMs}`)?.count).toBe(1);
  });

  it('refunds both oidc:ip: and oidc:email: quotas on MFA delegation paths (mfa_required and mfa_setup_required)', async () => {
    setValidOidcEnv({ AUTH_RATE_LIMIT_MAX: '2', AUTH_RATE_LIMIT_WINDOW_MS: '900000' });
    const windowStartMs = computeWindowStartMs(FROZEN_NOW_MS, 900_000);
    const txToken = await signOidcTxCookie({
      state: 'state-123',
      nonce: 'nonce-123',
      codeVerifier: 'pkce-verifier-123',
    });

    // mfa_required
    mocks.extractClientIp.mockReturnValueOnce('198.51.100.66');
    mocks.tenantPolicyFindUnique.mockResolvedValueOnce({ requireMfa: false });
    mocks.authorizationCodeGrant.mockResolvedValueOnce({
      claims: () => ({
        sub: 'sub-mfa-refund',
        iss: 'https://idp.example.com/realms/ftth',
        aud: 'ftth-web',
        exp: Math.floor(Date.now() / 1000) + 600,
        nonce: 'nonce-123',
        email: 'mfa-refund@example.com',
        email_verified: true,
      }),
      access_token: 'at-1',
    });
    mocks.userIdentityFindUnique.mockResolvedValueOnce({
      id: 'ident-mfa-refund',
      userId: 'user-mfa-refund',
      tenantId: 'tenant-1',
    });
    mocks.userFindUnique
      .mockResolvedValueOnce({ id: 'user-mfa-refund' })
      .mockResolvedValueOnce({
        id: 'user-mfa-refund',
        email: 'mfa-refund@example.com',
        name: 'MFA Refund',
        role: 'OPERATOR',
        tenantId: 'tenant-1',
        mfaEnabled: true,
        totpSecret: 'enc-totp-secret',
      });

    const mfaReqRes = await oidcCallbackGet(
      new Request('http://localhost:3001/api/auth/oidc/callback?code=c1&state=state-123', {
        headers: {
          cookie: `${OIDC_TX_COOKIE_NAME}=${txToken}`,
          'x-forwarded-for': '198.51.100.66',
        },
      }),
    );
    expect(mfaReqRes.status).toBe(302);
    expect(mfaReqRes.headers.get('location')).toContain(
      '/login?mfa=required&tempToken=temp-user-mfa-refund',
    );
    expect(mocks.sessionCreate).not.toHaveBeenCalled();
    expect(mocks.buckets.get(`oidc:ip:198.51.100.66:${windowStartMs}`)?.count).toBe(0);
    expect(mocks.buckets.get(`oidc:email:mfa-refund@example.com:${windowStartMs}`)?.count).toBe(0);

    // mfa_setup_required
    mocks.extractClientIp.mockReturnValueOnce('198.51.100.67');
    mocks.tenantPolicyFindUnique.mockResolvedValueOnce({ requireMfa: true });
    mocks.authorizationCodeGrant.mockResolvedValueOnce({
      claims: () => ({
        sub: 'sub-setup-refund',
        iss: 'https://idp.example.com/realms/ftth',
        aud: 'ftth-web',
        exp: Math.floor(Date.now() / 1000) + 600,
        nonce: 'nonce-123',
        email: 'setup-refund@example.com',
        email_verified: true,
      }),
      access_token: 'at-1',
    });
    mocks.userIdentityFindUnique.mockResolvedValueOnce({
      id: 'ident-setup-refund',
      userId: 'user-setup-refund',
      tenantId: 'tenant-1',
    });
    mocks.userFindUnique
      .mockResolvedValueOnce({ id: 'user-setup-refund' })
      .mockResolvedValueOnce({
        id: 'user-setup-refund',
        email: 'setup-refund@example.com',
        name: 'Setup Refund',
        role: 'OPERATOR',
        tenantId: 'tenant-1',
        mfaEnabled: false,
        totpSecret: null,
      });

    const mfaSetupRes = await oidcCallbackGet(
      new Request('http://localhost:3001/api/auth/oidc/callback?code=c1&state=state-123', {
        headers: {
          cookie: `${OIDC_TX_COOKIE_NAME}=${txToken}`,
          'x-forwarded-for': '198.51.100.67',
        },
      }),
    );
    expect(mfaSetupRes.status).toBe(302);
    expect(mfaSetupRes.headers.get('location')).toContain(
      '/login?mfa=setup_required&tempToken=temp-user-setup-refund',
    );
    expect(mocks.sessionCreate).not.toHaveBeenCalled();
    expect(mocks.buckets.get(`oidc:ip:198.51.100.67:${windowStartMs}`)?.count).toBe(0);
    expect(mocks.buckets.get(`oidc:email:setup-refund@example.com:${windowStartMs}`)?.count).toBe(0);
  });
});
