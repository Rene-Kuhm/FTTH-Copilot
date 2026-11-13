import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
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
  userIdentityFindUnique: vi.fn(),
  userIdentityCreate: vi.fn(),
  userFindUnique: vi.fn(),
  userFindUniqueOrThrow: vi.fn(),
  userCreate: vi.fn(),
  sessionCreate: vi.fn(),
  transaction: vi.fn(),
  audit: vi.fn(),
  auditLogin: vi.fn(),
}));

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
  checkAuthQuota: vi.fn(async () => ({ allowed: true })),
  recordAuthAttempt: vi.fn(),
  authRateLimitKeys: vi.fn(() => []),
  extractClientIp: vi.fn(() => '192.0.2.10'),
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
    for (const k of ENV_KEYS) delete process.env[k];
    mocks.discovery.mockResolvedValue({ serverMetadata: () => ({}) });
    mocks.tenantFindUnique.mockResolvedValue({ id: 'tenant-1', slug: 'demo-isp' });
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
});
