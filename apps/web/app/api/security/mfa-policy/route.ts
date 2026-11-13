import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@ftth-copilot/db';
import { getCurrentUser } from '@/lib/auth/server';
import { isTenantMfaRequired } from '@/lib/auth/mfa-policy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const updateMfaPolicySchema = z.object({
  requireMfa: z.boolean(),
});

export async function GET(): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const requireMfa = await isTenantMfaRequired(user.tenantId);
  return NextResponse.json({ requireMfa });
}

export async function PUT(req: Request): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  if (user.role !== 'OWNER' && user.role !== 'ADMIN') {
    return NextResponse.json(
      { error: 'Only OWNER or ADMIN can update tenant MFA policy' },
      { status: 403 },
    );
  }

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = updateMfaPolicySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const policy = await prisma.tenantPolicy.upsert({
    where: { tenantId: user.tenantId },
    create: {
      tenantId: user.tenantId,
      requireMfa: parsed.data.requireMfa,
    },
    update: {
      requireMfa: parsed.data.requireMfa,
    },
    select: { requireMfa: true },
  });

  return NextResponse.json({ requireMfa: policy.requireMfa });
}
