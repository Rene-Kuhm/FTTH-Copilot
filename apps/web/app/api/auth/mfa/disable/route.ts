/**
 * MFA Disable Route
 *
 * POST /api/auth/mfa/disable
 *
 * Disables MFA for the authenticated user. Requires a valid current TOTP code
 * as a security measure — anyone with the user's password but without access
 * to the authenticator cannot disable MFA.
 *
 * Body: { code: string } — current TOTP code
 */
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/server';
import { prisma, decryptApiKey } from '@ftth-copilot/db';
import { verifyTOTP } from '@/lib/auth/totp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body.code !== 'string') {
    return NextResponse.json({ error: 'Missing code' }, { status: 400 });
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { mfaEnabled: true, totpSecret: true },
  });

  if (!dbUser?.mfaEnabled || !dbUser?.totpSecret) {
    return NextResponse.json({ error: 'MFA is not enabled' }, { status: 400 });
  }

  const secret = decryptApiKey(dbUser.totpSecret);
  if (!verifyTOTP(secret, body.code)) {
    return NextResponse.json({ error: 'Código MFA inválido' }, { status: 401 });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { mfaEnabled: false, totpSecret: null },
  });

  return NextResponse.json({ ok: true, message: 'MFA deshabilitado correctamente' });
}
