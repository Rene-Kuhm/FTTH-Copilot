import { NextResponse } from 'next/server';
import { prisma } from '@ftth-copilot/db';
import { getCurrentUser } from '@/lib/auth/server';
import { hasPermission } from '@/lib/auth/permissions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PATCH /api/predictions/[id] — acknowledge a proactive alert so time-based
 * escalation stops. Idempotent: acking an already-acknowledged alert is a no-op.
 */
export async function PATCH(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!hasPermission(user.role, 'ack_alerts')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const { id } = await ctx.params;
  const result = await prisma.detectedAlert.updateMany({
    where: { id, tenantId: user.tenantId, status: { in: ['open', 'acknowledged'] } },
    data: { status: 'acknowledged' },
  });

  if (result.count === 0) {
    return NextResponse.json({ error: 'Alert not found' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
