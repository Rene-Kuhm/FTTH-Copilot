/**
 * MFA Verify Route
 *
 * POST /api/auth/mfa/verify
 *
 * Verifies a TOTP code and enables MFA for the user.
 * Called after setup to confirm the authenticator is working.
 *
 * Also handles ongoing MFA verification during login when MFA is enabled.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/server';
import { prisma, issueToken, COOKIE_NAME, sessionCookieAttributes, TOKEN_TTL_SECONDS, decryptApiKey, extractClientIp } from '@ftth-copilot/db';
import { verifyTOTP } from '@/lib/auth/totp';
import { auditAuth } from '@ftth-copilot/soc';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function setSessionCookie(token: string): string {
  const attrs = sessionCookieAttributes();
  const parts = [
    `${COOKIE_NAME}=${token}`,
    `Max-Age=${TOKEN_TTL_SECONDS}`,
    `Path=${attrs.path}`,
    'HttpOnly',
  ];
  if (attrs.sameSite === 'lax') parts.push('SameSite=Lax');
  if (attrs.secure) parts.push('Secure');
  return parts.join('; ');
}

/**
 * POST /api/auth/mfa/verify
 *
 * Body options:
 * 1. { email, password, code } - Full login with MFA
 * 2. { code } - Verify pending MFA setup (requires session)
 * 3. { tempToken, code } - Continue login after initial credentials (MFA required)
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Case 1: Full login with MFA (email + password + code)
  if (body.email && body.password && body.code) {
    return handleMfaLogin(req, body.email, body.password, body.code);
  }

  // Case 2: Verify pending MFA setup (requires session)
  if (body.code && !body.tempToken) {
    return handleSetupVerification(req, body.code);
  }

  // Case 3: Continue login with tempToken
  if (body.tempToken && body.code) {
    return handleMfaContinue(req, body.tempToken, body.code);
  }

  return NextResponse.json(
    { error: 'Invalid payload. Provide (email, password, code) or (code) or (tempToken, code)' },
    { status: 400 },
  );
}

async function handleMfaLogin(
  req: NextRequest,
  email: string,
  password: string,
  code: string,
): Promise<NextResponse> {
  const { verifyPassword } = await import('@ftth-copilot/db');

  // Verify credentials
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    const ip = extractClientIp(req.headers.get('x-forwarded-for'));
    await auditAuth.login(
      { tenantId: 'unknown', actorId: 'unknown', ipAddress: ip ?? undefined },
      email,
      false,
    );
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    const ip = extractClientIp(req.headers.get('x-forwarded-for'));
    await auditAuth.login(
      { tenantId: user.tenantId, actorId: user.id, actorEmail: user.email, ipAddress: ip ?? undefined },
      user.id,
      false,
    );
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  // If MFA is enabled, verify the code
  if (user.mfaEnabled && user.totpSecret) {
    const secret = decryptApiKey(user.totpSecret);
    if (!verifyTOTP(secret, code)) {
      return NextResponse.json({ error: 'Invalid MFA code' }, { status: 401 });
    }
  } else if (user.mfaEnabled) {
    // MFA enabled but no secret - shouldn't happen
    return NextResponse.json({ error: 'MFA not configured properly' }, { status: 500 });
  }

  // Issue session
  const ip = extractClientIp(req.headers.get('x-forwarded-for'));
  const { token, tokenHash, expiresAt } = issueToken(user.id, user.tenantId, user.role);
  await prisma.session.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt,
      userAgent: req.headers.get('user-agent') ?? null,
      ipAddress: ip,
    },
  });

  await auditAuth.login(
    { tenantId: user.tenantId, actorId: user.id, actorEmail: user.email, actorRole: user.role, ipAddress: ip ?? undefined },
    user.id,
    true,
  );

  return new NextResponse(
    JSON.stringify({ user: { id: user.id, email: user.email, name: user.name, role: user.role } }),
    {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'set-cookie': setSessionCookie(token),
      },
    },
  );
}

async function handleSetupVerification(
  req: NextRequest,
  code: string,
): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  // Get pending secret
  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { mfaEnabled: true, totpSecret: true },
  });

  if (!dbUser?.totpSecret) {
    return NextResponse.json({ error: 'No MFA setup pending' }, { status: 400 });
  }

  if (dbUser.mfaEnabled) {
    return NextResponse.json({ error: 'MFA already enabled' }, { status: 409 });
  }

  const secret = decryptApiKey(dbUser.totpSecret);
  if (!verifyTOTP(secret, code)) {
    return NextResponse.json({ error: 'Invalid verification code' }, { status: 401 });
  }

  // Enable MFA
  await prisma.user.update({
    where: { id: user.id },
    data: { mfaEnabled: true },
  });

  return NextResponse.json({
    mfaEnabled: true,
    message: 'MFA has been enabled successfully',
  });
}

async function handleMfaContinue(
  req: NextRequest,
  tempToken: string,
  code: string,
): Promise<NextResponse> {
  // Verify tempToken and extract user info
  const { verifyToken } = await import('@ftth-copilot/db');
  const claims = verifyToken(tempToken);
  if (!claims) {
    return NextResponse.json({ error: 'Invalid or expired temp token' }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: claims.sub },
    select: { id: true, email: true, name: true, role: true, tenantId: true, mfaEnabled: true, totpSecret: true },
  });

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  // Verify MFA code
  if (!user.totpSecret) {
    return NextResponse.json({ error: 'MFA not configured' }, { status: 400 });
  }

  const secret = decryptApiKey(user.totpSecret);
  if (!verifyTOTP(secret, code)) {
    return NextResponse.json({ error: 'Invalid MFA code' }, { status: 401 });
  }

  // Issue real session
  const ip = extractClientIp(req.headers.get('x-forwarded-for'));
  const { token, tokenHash, expiresAt } = issueToken(user.id, user.tenantId, user.role);
  await prisma.session.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt,
      userAgent: req.headers.get('user-agent') ?? null,
      ipAddress: ip,
    },
  });

  await auditAuth.login(
    { tenantId: user.tenantId, actorId: user.id, actorEmail: user.email, actorRole: user.role, ipAddress: ip ?? undefined },
    user.id,
    true,
  );

  return new NextResponse(
    JSON.stringify({ user: { id: user.id, email: user.email, name: user.name, role: user.role } }),
    {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'set-cookie': setSessionCookie(token),
      },
    },
  );
}
