import { NextResponse } from 'next/server';
import { prisma } from '@ftth-copilot/db';
import { getCurrentUser } from '@/lib/auth/server';
import { hasPermission } from '@/lib/auth/permissions';
import { listSuppressedEvents } from '@/lib/maintenance/suppression-audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/maintenance-windows/:id/suppressions — list suppressed events
 * recorded during a maintenance window for auditing (Roadmap Fase 5 — 5.4 + Gate 5).
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  if (!hasPermission(user.role, 'manage_maintenance')) {
    return NextResponse.json(
      { error: 'forbidden', missing: 'manage_maintenance' },
      { status: 403 },
    );
  }
  const { id } = await ctx.params;

  const window = await prisma.maintenanceWindow.findUnique({ where: { id } });
  if (window === null) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (window.tenantId !== user.tenantId) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const suppressions = await listSuppressedEvents(prisma, {
    tenantId: user.tenantId,
    windowId: id,
  });

  return NextResponse.json({
    windowId: id,
    suppressions,
  });
}
