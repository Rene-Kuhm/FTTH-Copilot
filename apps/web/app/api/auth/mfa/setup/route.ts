/**
 * MFA Setup Route
 *
 * POST /api/auth/mfa/setup
 *
 * Generates a new TOTP secret for the authenticated user.
 * Returns the otpauth:// URI and base32 secret for QR code generation.
 * The secret is NOT yet enabled until the user verifies a code via /api/auth/mfa/verify.
 */
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/server';
import { prisma } from '@ftth-copilot/db';
import { generateSecret, generateOtpAuthUri } from '@/lib/auth/totp';
import { encryptApiKey } from '@ftth-copilot/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  // Check if MFA is already enabled
  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { mfaEnabled: true, totpSecret: true },
  });

  if (!dbUser) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  // If MFA is already enabled, require verification to change
  if (dbUser.mfaEnabled && dbUser.totpSecret) {
    return NextResponse.json(
      { error: 'MFA is already enabled. Disable it first to change the secret.' },
      { status: 409 },
    );
  }

  // Generate new TOTP secret
  const secret = generateSecret();
  const issuer = 'FTTH-Copilot';
  const account = user.email;

  // Encrypt secret for storage (same as API keys)
  const { encryptedKey: encryptedTotpSecret } = encryptApiKey(secret);

  // Store pending secret (not enabled yet)
  await prisma.user.update({
    where: { id: user.id },
    data: { totpSecret: encryptedTotpSecret },
  });

  // Generate otpauth URI for QR code
  const otpauthUri = generateOtpAuthUri(secret, issuer, account);

  return NextResponse.json({
    secret, // Base32 secret (show to user for manual entry fallback)
    otpauthUri,
    issuer,
    account,
    format: 'base32',
    digits: 6,
    period: 30,
  });
}

/**
 * GET /api/auth/mfa/setup
 *
 * Check if MFA is enabled for the current user.
 */
export async function GET(): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { mfaEnabled: true },
  });

  return NextResponse.json({
    mfaEnabled: dbUser?.mfaEnabled ?? false,
  });
}

/**
 * DELETE /api/auth/mfa/setup
 *
 * Disable MFA for the current user.
 * Requires current TOTP verification.
 */
export async function DELETE(req: Request): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body?.code) {
    return NextResponse.json({ error: 'Verification code required' }, { status: 400 });
  }

  // Get encrypted secret
  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { mfaEnabled: true, totpSecret: true },
  });

  if (!dbUser?.totpSecret) {
    return NextResponse.json({ error: 'MFA not configured' }, { status: 400 });
  }

  // Decrypt and verify
  const { decryptApiKey } = await import('@ftth-copilot/db');
  const secret = decryptApiKey(dbUser.totpSecret);

  const { verifyTOTP } = await import('@/lib/auth/totp');
  if (!verifyTOTP(secret, body.code)) {
    return NextResponse.json({ error: 'Invalid verification code' }, { status: 401 });
  }

  // Disable MFA
  await prisma.user.update({
    where: { id: user.id },
    data: { mfaEnabled: false, totpSecret: null },
  });

  return NextResponse.json({ mfaEnabled: false });
}
