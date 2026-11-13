import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  COOKIE_NAME,
  TOKEN_TTL_SECONDS,
  authRateLimitKeys,
  checkAuthQuota,
  extractClientIp,
  hashPassword,
  issueToken,
  prisma,
  recordAuthAttempt,
  sessionCookieAttributes,
} from '@ftth-copilot/db';
import { auditAuth, authenticateLdapUser } from '@ftth-copilot/soc';
import { createLogger, correlationIdFrom } from '@ftth-copilot/shared';
import { generateCsrfToken } from './csrf';
import { evaluateMfaGate, isTenantMfaRequired } from './mfa-policy';

const log = createLogger({ name: 'auth-ldap' });

function setSessionCookie(token: string): string {
  const attrs = sessionCookieAttributes();
  const parts = [
    `${COOKIE_NAME}=${token}`,
    `Max-Age=${TOKEN_TTL_SECONDS}`,
    `Path=${attrs.path}`,
    'HttpOnly',
  ];
  if (attrs.sameSite === 'lax') parts.push('SameSite=Lax');
  if (attrs.sameSite === 'strict') parts.push('SameSite=Strict');
  if (attrs.secure) parts.push('Secure');
  return parts.join('; ');
}

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new NextResponse(JSON.stringify(body), {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...init?.headers,
    },
  });
}

export interface LdapLoginAttemptInput {
  req: Request;
  username: string;
  password: string;
  code?: string;
}

/**
 * Authenticate a user against the configured LDAP/AD directory, provision or
 * sync their local user record in the configured `LDAP_TENANT_SLUG`, enforce
 * user & tenant MFA policy, and issue the standard session + CSRF cookies.
 */
export async function authenticateAndIssueLdapSession({
  req,
  username,
  password,
  code,
}: LdapLoginAttemptInput): Promise<NextResponse> {
  const requestLog = log.child({ correlationId: correlationIdFrom(req.headers) });
  const clientIp = extractClientIp(req.headers.get('x-forwarded-for'));
  const rateKeys = authRateLimitKeys(username, clientIp);
  const max = Number.parseInt(process.env['AUTH_RATE_LIMIT_MAX'] ?? '', 10) || 10;
  const windowMs = Number.parseInt(process.env['AUTH_RATE_LIMIT_WINDOW_MS'] ?? '', 10) || 15 * 60 * 1000;

  for (const key of rateKeys) {
    const decision = await checkAuthQuota(key, { max, windowMs });
    if (!decision.allowed) {
      return jsonResponse(
        { error: 'Demasiados intentos. Probá de nuevo más tarde.' },
        { status: 429, headers: { 'retry-after': String(decision.retryAfter) } },
      );
    }
  }

  const tenantSlug = process.env['LDAP_TENANT_SLUG']?.trim();
  if (!tenantSlug) {
    requestLog.error('LDAP_TENANT_SLUG is not configured');
    return jsonResponse(
      { error: 'LDAP tenant configuration is missing' },
      { status: 500 },
    );
  }

  const tenant = await prisma.tenant.findUnique({
    where: { slug: tenantSlug },
    select: { id: true, name: true, slug: true },
  });
  if (!tenant) {
    requestLog.error('Configured LDAP_TENANT_SLUG does not exist', { tenantSlug });
    return jsonResponse(
      { error: 'Configured LDAP tenant not found' },
      { status: 500 },
    );
  }

  const ldapResult = await authenticateLdapUser(username, password);
  if (!ldapResult.ok || !ldapResult.user) {
    for (const key of rateKeys) {
      await recordAuthAttempt(key, { max, windowMs });
    }
    await auditAuth.login(
      { tenantId: tenant.id, actorId: username, ipAddress: clientIp ?? undefined },
      username,
      false,
    );
    return jsonResponse({ error: 'Invalid credentials' }, { status: 401 });
  }

  const ldapUser = ldapResult.user;
  const normalizedEmail = ldapUser.email.trim().toLowerCase();

  let user = await prisma.user.findUnique({
    where: { tenantId_email: { tenantId: tenant.id, email: normalizedEmail } },
  });

  if (!user) {
    // Provision LDAP user with an unguessable random password hash so local password login stays disabled.
    const unusableSecret = randomBytes(32).toString('hex');
    const passwordHash = await hashPassword(unusableSecret);
    user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        name: ldapUser.name,
        passwordHash,
        role: ldapUser.role,
        tenantId: tenant.id,
      },
    });
  } else if (user.role !== ldapUser.role || user.name !== ldapUser.name) {
    user = await prisma.user.update({
      where: { id: user.id },
      data: {
        role: ldapUser.role,
        name: ldapUser.name,
      },
    });
  }

  const tenantRequiresMfa = await isTenantMfaRequired(tenant.id);
  const mfaGate = evaluateMfaGate(user, tenantRequiresMfa, code);

  if (mfaGate.action === 'invalid_code') {
    return jsonResponse({ error: 'Invalid MFA code' }, { status: 401 });
  }
  if (mfaGate.action === 'mfa_required') {
    return jsonResponse({ mfaRequired: true, tempToken: mfaGate.tempToken }, { status: 200 });
  }
  if (mfaGate.action === 'mfa_setup_required') {
    return jsonResponse(
      {
        error: 'MFA is required by your organization policy. Configure TOTP before signing in.',
        code: 'MFA_SETUP_REQUIRED',
        mfaSetupRequired: true,
        tempToken: mfaGate.tempToken,
      },
      { status: 403 },
    );
  }

  const { token, tokenHash, expiresAt } = issueToken(user.id, user.tenantId, user.role);
  await prisma.session.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt,
      userAgent: req.headers.get('user-agent') ?? null,
      ipAddress: clientIp,
    },
  });

  await auditAuth.login(
    {
      tenantId: user.tenantId,
      actorId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      ipAddress: clientIp ?? undefined,
    },
    user.id,
    true,
  );

  const { cookie: csrfCookie } = generateCsrfToken();

  return jsonResponse(
    {
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      authMethod: 'ldap',
    },
    {
      status: 200,
      headers: {
        'set-cookie': `${setSessionCookie(token)}, ${csrfCookie}`,
      },
    },
  );
}
