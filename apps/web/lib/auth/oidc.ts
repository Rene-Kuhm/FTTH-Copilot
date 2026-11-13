/**
 * OIDC / SSO authentication module (OAuth 2.0 Authorization Code + PKCE S256).
 *
 * Uses `openid-client` v6 for OIDC discovery, PKCE, and ID token verification,
 * then issues the exact same FTTH-Copilot session cookie and CSRF token as local login.
 *
 * Scope v1: single IdP per installation bound to one tenant via `OIDC_TENANT_SLUG`.
 */
import * as client from 'openid-client';
import { SignJWT, jwtVerify } from 'jose';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import {
  createLogger,
  correlationIdFrom,
} from '@ftth-copilot/shared';
import {
  mapGroupsToRole,
  parseRoleMap,
  type AppRole,
} from '@ftth-copilot/security';
import {
  prisma,
  hashPassword,
  issueToken,
  sessionCookieAttributes,
  extractClientIp,
} from '@ftth-copilot/db';
import { audit, auditAuth } from '@ftth-copilot/soc';
import { issueSessionForUser } from './server';

const log = createLogger({ name: 'oidc' });

export const OIDC_TX_COOKIE_NAME = 'ftth_oidc_tx';
const OIDC_TX_TTL_SECONDS = 300; // 5 minutes

export interface EnabledOidcConfig {
  enabled: true;
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  tenantSlug: string;
  allowedEmailDomains: string[];
  autoProvision: boolean;
  roleClaim: string;
  roleMap: Map<string, AppRole>;
}

export type OidcConfig = { enabled: false } | EnabledOidcConfig;

const enabledOidcEnvSchema = z.object({
  OIDC_ISSUER: z.string().url('OIDC_ISSUER must be a valid URL'),
  OIDC_CLIENT_ID: z.string().min(1, 'OIDC_CLIENT_ID is required'),
  OIDC_CLIENT_SECRET: z.string().min(1, 'OIDC_CLIENT_SECRET is required'),
  OIDC_REDIRECT_URI: z.string().url('OIDC_REDIRECT_URI must be a valid URL'),
  OIDC_TENANT_SLUG: z.string().min(1, 'OIDC_TENANT_SLUG is required'),
  OIDC_ALLOWED_EMAIL_DOMAINS: z.string().optional(),
  OIDC_AUTO_PROVISION: z.enum(['true', 'false']).optional(),
  OIDC_ROLE_CLAIM: z.string().min(1).optional(),
  OIDC_ROLE_MAP: z.string().optional(),
});

function parseAllowedDomains(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter((d) => d.length > 0);
}

/**
 * Parse and validate OIDC configuration from environment variables.
 * Throws a descriptive error if `OIDC_ENABLED=true` and required variables are missing/invalid.
 */
export function parseOidcConfig(env: Record<string, string | undefined> = process.env): OidcConfig {
  if (env['OIDC_ENABLED'] !== 'true') {
    return { enabled: false };
  }

  const parsed = enabledOidcEnvSchema.safeParse({
    OIDC_ISSUER: env['OIDC_ISSUER'],
    OIDC_CLIENT_ID: env['OIDC_CLIENT_ID'],
    OIDC_CLIENT_SECRET: env['OIDC_CLIENT_SECRET'],
    OIDC_REDIRECT_URI: env['OIDC_REDIRECT_URI'],
    OIDC_TENANT_SLUG: env['OIDC_TENANT_SLUG'],
    OIDC_ALLOWED_EMAIL_DOMAINS: env['OIDC_ALLOWED_EMAIL_DOMAINS'],
    OIDC_AUTO_PROVISION: env['OIDC_AUTO_PROVISION'],
    OIDC_ROLE_CLAIM: env['OIDC_ROLE_CLAIM'],
    OIDC_ROLE_MAP: env['OIDC_ROLE_MAP'],
  });

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.') || 'config'}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid OIDC configuration when OIDC_ENABLED=true: ${issues}`);
  }

  const data = parsed.data;
  return {
    enabled: true,
    issuer: data.OIDC_ISSUER,
    clientId: data.OIDC_CLIENT_ID,
    clientSecret: data.OIDC_CLIENT_SECRET,
    redirectUri: data.OIDC_REDIRECT_URI,
    tenantSlug: data.OIDC_TENANT_SLUG,
    allowedEmailDomains: parseAllowedDomains(data.OIDC_ALLOWED_EMAIL_DOMAINS),
    autoProvision: data.OIDC_AUTO_PROVISION === 'true',
    roleClaim: data.OIDC_ROLE_CLAIM ?? 'groups',
    roleMap: parseRoleMap(data.OIDC_ROLE_MAP, []),
  };
}

export function isOidcEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env['OIDC_ENABLED'] === 'true';
}

export function assertValidOidcConfig(env: Record<string, string | undefined> = process.env): void {
  parseOidcConfig(env);
}

/**
 * Pure check: returns true only if `email` has a domain present in `allowedDomains` (case-insensitive).
 */
export function isEmailDomainAllowed(
  email: string,
  allowedDomains: readonly string[],
): boolean {
  const atIdx = email.lastIndexOf('@');
  if (atIdx <= 0 || atIdx === email.length - 1) return false;
  const domain = email.slice(atIdx + 1).trim().toLowerCase();
  if (!domain) return false;
  return allowedDomains.some((allowed) => allowed.trim().toLowerCase() === domain);
}

/**
 * Extract group strings from an ID token or UserInfo claim object.
 */
export function extractGroupsFromClaims(
  claims: Record<string, unknown>,
  roleClaim: string,
): string[] {
  const raw = claims[roleClaim];
  if (Array.isArray(raw)) {
    return raw.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  }
  if (typeof raw === 'string' && raw.trim().length > 0) {
    return [raw.trim()];
  }
  return [];
}

export type ClaimValidationResult =
  | {
      ok: true;
    }
  | {
      ok: false;
      reason: 'missing_sub' | 'invalid_issuer' | 'invalid_audience' | 'token_expired' | 'invalid_nonce';
      message: string;
    };

/**
 * Defensive verification of standard OIDC ID token claims (`iss`, `aud`, `exp`, `nonce`, `sub`).
 */
export function validateOidcIdTokenClaims(
  claims: Record<string, unknown>,
  expected: {
    issuer: string;
    clientId: string;
    nonce: string;
    nowSeconds?: number;
  },
): ClaimValidationResult {
  const sub = claims['sub'];
  if (typeof sub !== 'string' || sub.length === 0) {
    return { ok: false, reason: 'missing_sub', message: 'Missing subject claim in ID token' };
  }

  const iss = claims['iss'];
  const normalizeIss = (u: string) => u.replace(/\/+$/, '');
  if (typeof iss !== 'string' || normalizeIss(iss) !== normalizeIss(expected.issuer)) {
    return { ok: false, reason: 'invalid_issuer', message: 'ID token issuer mismatch' };
  }

  const aud = claims['aud'];
  const audMatches = Array.isArray(aud)
    ? aud.includes(expected.clientId)
    : aud === expected.clientId;
  if (!audMatches) {
    return { ok: false, reason: 'invalid_audience', message: 'ID token audience mismatch' };
  }

  const exp = claims['exp'];
  const now = expected.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (typeof exp !== 'number' || exp <= now) {
    return { ok: false, reason: 'token_expired', message: 'ID token has expired' };
  }

  const nonce = claims['nonce'];
  if (typeof nonce !== 'string' || nonce !== expected.nonce) {
    return { ok: false, reason: 'invalid_nonce', message: 'ID token nonce mismatch' };
  }

  return { ok: true };
}

export type OidcIdentityDecision =
  | { action: 'login'; userId: string }
  | { action: 'link'; userId: string }
  | { action: 'provision'; email: string; role: AppRole }
  | {
      action: 'reject';
      reason:
        | 'tenant_mismatch'
        | 'missing_email'
        | 'email_not_verified'
        | 'domain_not_allowed'
        | 'user_not_found';
      message: string;
    };

export interface ResolveOidcIdentityInput {
  existingIdentity: { userId: string; tenantId: string } | null;
  targetTenantId: string;
  existingUserInTenant: { id: string } | null;
  email: string | undefined;
  emailVerified: boolean;
  allowedEmailDomains: readonly string[];
  autoProvision: boolean;
  groups: readonly string[];
  roleMap: ReadonlyMap<string, AppRole>;
}

/**
 * Pure decision function for OIDC first-login linking, auto-provisioning, or rejection.
 * Enforces strict tenant isolation: an identity bound to another tenant is always rejected.
 */
export function resolveOidcIdentityDecision(
  input: ResolveOidcIdentityInput,
): OidcIdentityDecision {
  if (input.existingIdentity) {
    if (input.existingIdentity.tenantId !== input.targetTenantId) {
      return {
        action: 'reject',
        reason: 'tenant_mismatch',
        message: 'La identidad SSO pertenece a otro tenant.',
      };
    }
    return { action: 'login', userId: input.existingIdentity.userId };
  }

  if (!input.email) {
    return {
      action: 'reject',
      reason: 'missing_email',
      message: 'El proveedor SSO no devolvió un email.',
    };
  }

  if (!input.emailVerified) {
    return {
      action: 'reject',
      reason: 'email_not_verified',
      message: 'El email de tu cuenta SSO no está verificado.',
    };
  }

  if (!isEmailDomainAllowed(input.email, input.allowedEmailDomains)) {
    return {
      action: 'reject',
      reason: 'domain_not_allowed',
      message: 'El dominio de tu email no está autorizado para ingresar por SSO.',
    };
  }

  if (input.existingUserInTenant) {
    return { action: 'link', userId: input.existingUserInTenant.id };
  }

  if (input.autoProvision) {
    const role = mapGroupsToRole(input.groups, input.roleMap, 'MEMBER');
    return { action: 'provision', email: input.email, role };
  }

  return {
    action: 'reject',
    reason: 'user_not_found',
    message: 'No existe un usuario habilitado para este email en el tenant.',
  };
}

interface OidcTxPayload {
  state: string;
  nonce: string;
  codeVerifier: string;
}

function getTxCookieKey(): Uint8Array {
  const secret = process.env['JWT_SECRET'];
  if (!secret) {
    if (process.env['NODE_ENV'] === 'production') {
      throw new Error('JWT_SECRET is required in production for OIDC state signing.');
    }
    return new TextEncoder().encode(
      'dev-only-insecure-secret-replace-me-in-production-please-32bytes-min',
    );
  }
  return new TextEncoder().encode(secret);
}

export async function signOidcTxCookie(payload: OidcTxPayload): Promise<string> {
  return new SignJWT({
    state: payload.state,
    nonce: payload.nonce,
    codeVerifier: payload.codeVerifier,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${OIDC_TX_TTL_SECONDS}s`)
    .sign(getTxCookieKey());
}

export async function verifyOidcTxCookie(token: string): Promise<OidcTxPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getTxCookieKey(), {
      algorithms: ['HS256'],
    });
    if (
      typeof payload['state'] === 'string' &&
      typeof payload['nonce'] === 'string' &&
      typeof payload['codeVerifier'] === 'string'
    ) {
      return {
        state: payload['state'],
        nonce: payload['nonce'],
        codeVerifier: payload['codeVerifier'],
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function buildOidcTxCookieHeader(token: string): string {
  const attrs = sessionCookieAttributes();
  const parts = [
    `${OIDC_TX_COOKIE_NAME}=${token}`,
    `Max-Age=${OIDC_TX_TTL_SECONDS}`,
    'Path=/api/auth/oidc',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (attrs.secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearOidcTxCookieHeader(): string {
  const attrs = sessionCookieAttributes();
  const parts = [
    `${OIDC_TX_COOKIE_NAME}=`,
    'Max-Age=0',
    'Path=/api/auth/oidc',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (attrs.secure) parts.push('Secure');
  return parts.join('; ');
}

function readCookieFromHeader(cookieHeader: string, name: string): string | undefined {
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match?.[1];
}

async function discoverOidcConfiguration(cfg: EnabledOidcConfig): Promise<client.Configuration> {
  const allowInsecure =
    process.env['NODE_ENV'] !== 'production' && cfg.issuer.startsWith('http://');
  return client.discovery(
    new URL(cfg.issuer),
    cfg.clientId,
    cfg.clientSecret,
    undefined,
    allowInsecure ? { execute: [client.allowInsecureRequests] } : undefined,
  );
}

function redirectToLoginError(req: Request, errorCode: string): Response {
  const target = new URL('/login', req.url);
  target.searchParams.set('error', errorCode);
  return new Response(null, {
    status: 302,
    headers: {
      location: target.toString(),
      'set-cookie': clearOidcTxCookieHeader(),
    },
  });
}

export async function handleOidcLogin(req: Request): Promise<Response> {
  let cfg: OidcConfig;
  try {
    cfg = parseOidcConfig();
  } catch (err) {
    log.error('Invalid OIDC configuration', { error: String(err) });
    return new Response(JSON.stringify({ error: 'OIDC configuration error' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (!cfg.enabled) {
    return new Response(JSON.stringify({ error: 'OIDC SSO is not enabled' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }

  try {
    const oidcConfig = await discoverOidcConfiguration(cfg);
    const codeVerifier = client.randomPKCECodeVerifier();
    const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
    const state = client.randomState();
    const nonce = client.randomNonce();

    const authUrl = client.buildAuthorizationUrl(oidcConfig, {
      redirect_uri: cfg.redirectUri,
      scope: 'openid email profile',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
      nonce,
    });

    const txJwt = await signOidcTxCookie({ state, nonce, codeVerifier });

    return new Response(null, {
      status: 302,
      headers: {
        location: authUrl.toString(),
        'set-cookie': buildOidcTxCookieHeader(txJwt),
      },
    });
  } catch (err) {
    log.error('OIDC login initiation failed', {
      correlationId: correlationIdFrom(req.headers),
      error: err instanceof Error ? err.message : String(err),
    });
    return redirectToLoginError(req, 'oidc_discovery_failed');
  }
}

export async function handleOidcCallback(req: Request): Promise<Response> {
  const requestLog = log.child({ correlationId: correlationIdFrom(req.headers) });

  let cfg: OidcConfig;
  try {
    cfg = parseOidcConfig();
  } catch (err) {
    requestLog.error('Invalid OIDC configuration', { error: String(err) });
    return new Response(JSON.stringify({ error: 'OIDC configuration error' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (!cfg.enabled) {
    return new Response(JSON.stringify({ error: 'OIDC SSO is not enabled' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }

  const txToken = readCookieFromHeader(req.headers.get('cookie') ?? '', OIDC_TX_COOKIE_NAME);
  if (!txToken) {
    return redirectToLoginError(req, 'oidc_missing_state');
  }

  const tx = await verifyOidcTxCookie(txToken);
  if (!tx) {
    return redirectToLoginError(req, 'oidc_invalid_state');
  }

  const ip = extractClientIp(req.headers.get('x-forwarded-for')) ?? undefined;

  let claims: Record<string, unknown>;
  let accessToken: string | undefined;
  let oidcConfig: client.Configuration;

  try {
    oidcConfig = await discoverOidcConfiguration(cfg);
    const currentUrl = new URL(req.url);
    const tokens = await client.authorizationCodeGrant(oidcConfig, currentUrl, {
      pkceCodeVerifier: tx.codeVerifier,
      expectedState: tx.state,
      expectedNonce: tx.nonce,
      idTokenExpected: true,
    });

    const idClaims = tokens.claims();
    if (!idClaims) {
      return redirectToLoginError(req, 'oidc_missing_id_token');
    }

    claims = idClaims as unknown as Record<string, unknown>;
    accessToken = tokens.access_token;
  } catch (err) {
    requestLog.warn('OIDC callback token exchange failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return redirectToLoginError(req, 'oidc_callback_failed');
  }

  const claimCheck = validateOidcIdTokenClaims(claims, {
    issuer: cfg.issuer,
    clientId: cfg.clientId,
    nonce: tx.nonce,
  });
  if (!claimCheck.ok) {
    requestLog.warn('OIDC ID token claim validation failed', { reason: claimCheck.reason });
    return redirectToLoginError(req, `oidc_${claimCheck.reason}`);
  }

  const subject = String(claims['sub']);

  // Fetch UserInfo if email or groups are missing from ID token
  let mergedClaims = claims;
  if (accessToken && (claims['email'] === undefined || claims[cfg.roleClaim] === undefined)) {
    try {
      const userInfo = await client.fetchUserInfo(oidcConfig, accessToken, subject);
      mergedClaims = { ...userInfo, ...claims };
    } catch {
      // Non-fatal: proceed with ID token claims
    }
  }

  const tenant = await prisma.tenant.findUnique({
    where: { slug: cfg.tenantSlug },
    select: { id: true, slug: true },
  });

  if (!tenant) {
    requestLog.error('Configured OIDC_TENANT_SLUG not found', { tenantSlug: cfg.tenantSlug });
    return redirectToLoginError(req, 'oidc_tenant_not_found');
  }

  const existingIdentity = await prisma.userIdentity.findUnique({
    where: {
      issuer_subject: {
        issuer: cfg.issuer,
        subject,
      },
    },
    select: { id: true, userId: true, tenantId: true },
  });

  const rawEmail = typeof mergedClaims['email'] === 'string'
    ? mergedClaims['email'].trim().toLowerCase()
    : undefined;
  const emailVerified = mergedClaims['email_verified'] === true;
  const groups = extractGroupsFromClaims(mergedClaims, cfg.roleClaim);

  const existingUserInTenant = rawEmail
    ? await prisma.user.findUnique({
        where: { tenantId_email: { tenantId: tenant.id, email: rawEmail } },
        select: { id: true },
      })
    : null;

  const decision = resolveOidcIdentityDecision({
    existingIdentity: existingIdentity
      ? { userId: existingIdentity.userId, tenantId: existingIdentity.tenantId }
      : null,
    targetTenantId: tenant.id,
    existingUserInTenant,
    email: rawEmail,
    emailVerified,
    allowedEmailDomains: cfg.allowedEmailDomains,
    autoProvision: cfg.autoProvision,
    groups,
    roleMap: cfg.roleMap,
  });

  if (decision.action === 'reject') {
    await audit(
      {
        tenantId: tenant.id,
        actorId: existingIdentity?.userId ?? 'unknown',
        actorEmail: rawEmail,
        ipAddress: ip,
      },
      {
        category: 'AUTH',
        action: 'oidc login rejected',
        resourceType: 'UserIdentity',
        resourceId: subject,
        outcome: 'FAILURE',
        metadata: { reason: decision.reason, issuer: cfg.issuer },
      },
    );
    return redirectToLoginError(req, `oidc_${decision.reason}`);
  }

  let userRecord: {
    id: string;
    email: string;
    name: string | null;
    role: 'OWNER' | 'ADMIN' | 'OPERATOR' | 'MEMBER';
    tenantId: string;
    mfaEnabled: boolean;
  };

  if (decision.action === 'login') {
    const found = await prisma.user.findUnique({
      where: { id: decision.userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        tenantId: true,
        mfaEnabled: true,
      },
    });
    if (!found || found.tenantId !== tenant.id) {
      return redirectToLoginError(req, 'oidc_tenant_mismatch');
    }
    userRecord = found;
  } else if (decision.action === 'link') {
    const found = await prisma.$transaction(async (txDb) => {
      const created = await txDb.userIdentity.create({
        data: {
          tenantId: tenant.id,
          userId: decision.userId,
          provider: 'oidc',
          issuer: cfg.issuer,
          subject,
        },
        select: { id: true },
      });
      const user = await txDb.user.findUniqueOrThrow({
        where: { id: decision.userId },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          tenantId: true,
          mfaEnabled: true,
        },
      });
      return { user, identityId: created.id };
    });

    await audit(
      {
        tenantId: tenant.id,
        actorId: found.user.id,
        actorEmail: found.user.email,
        actorRole: found.user.role,
        ipAddress: ip,
      },
      {
        category: 'AUTH',
        action: 'oidc identity linked',
        resourceType: 'UserIdentity',
        resourceId: found.identityId,
        outcome: 'SUCCESS',
        metadata: { issuer: cfg.issuer, subject },
      },
    );
    userRecord = found.user;
  } else {
    // Auto-provision new user + UserIdentity
    const unusablePasswordHash = await hashPassword(randomBytes(32).toString('hex'));
    const displayName =
      typeof mergedClaims['name'] === 'string' && mergedClaims['name'].trim().length > 0
        ? mergedClaims['name'].trim().slice(0, 120)
        : null;

    try {
      const created = await prisma.$transaction(async (txDb) => {
        const user = await txDb.user.create({
          data: {
            email: decision.email,
            name: displayName,
            passwordHash: unusablePasswordHash,
            role: decision.role,
            tenantId: tenant.id,
          },
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            tenantId: true,
            mfaEnabled: true,
          },
        });
        await txDb.userIdentity.create({
          data: {
            tenantId: tenant.id,
            userId: user.id,
            provider: 'oidc',
            issuer: cfg.issuer,
            subject,
          },
        });
        return user;
      });

      await audit(
        {
          tenantId: tenant.id,
          actorId: created.id,
          actorEmail: created.email,
          actorRole: created.role,
          ipAddress: ip,
        },
        {
          category: 'AUTH',
          action: 'oidc user provisioned',
          resourceType: 'User',
          resourceId: created.id,
          outcome: 'SUCCESS',
          metadata: { issuer: cfg.issuer, subject, role: created.role },
        },
      );
      userRecord = created;
    } catch (err) {
      // User.email is globally unique: if email belongs to another tenant, reject cleanly
      requestLog.warn('OIDC user auto-provisioning failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      await audit(
        { tenantId: tenant.id, actorId: 'unknown', actorEmail: decision.email, ipAddress: ip },
        {
          category: 'AUTH',
          action: 'oidc login rejected',
          resourceType: 'UserIdentity',
          resourceId: subject,
          outcome: 'FAILURE',
          metadata: { reason: 'provision_conflict', issuer: cfg.issuer },
        },
      );
      return redirectToLoginError(req, 'oidc_provision_conflict');
    }
  }

  // If the user has TOTP MFA enabled, require MFA verification before issuing a full session
  if (userRecord.mfaEnabled) {
    const { token: tempToken } = issueToken(
      userRecord.id,
      userRecord.tenantId,
      userRecord.role,
      true,
    );
    const mfaUrl = new URL('/login', req.url);
    mfaUrl.searchParams.set('mfa', 'required');
    mfaUrl.searchParams.set('tempToken', tempToken);
    return new Response(null, {
      status: 302,
      headers: {
        location: mfaUrl.toString(),
        'set-cookie': clearOidcTxCookieHeader(),
      },
    });
  }

  const { sessionCookie, csrfCookie } = await issueSessionForUser(userRecord, req);

  await auditAuth.login(
    {
      tenantId: userRecord.tenantId,
      actorId: userRecord.id,
      actorEmail: userRecord.email,
      actorRole: userRecord.role,
      ipAddress: ip,
    },
    userRecord.id,
    true,
    { provider: 'oidc', issuer: cfg.issuer },
  );

  const appUrl = new URL('/app', req.url);
  const headers = new Headers();
  headers.set('location', appUrl.toString());
  headers.append('set-cookie', sessionCookie);
  headers.append('set-cookie', csrfCookie);
  headers.append('set-cookie', clearOidcTxCookieHeader());

  return new Response(null, {
    status: 302,
    headers,
  });
}
