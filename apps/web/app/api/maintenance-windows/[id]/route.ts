import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@ftth-copilot/db';
import { getCurrentUser } from '@/lib/auth/server';
import { hasPermission } from '@/lib/auth/permissions';

/**
 * DELETE /api/maintenance-windows/:id — cancel a maintenance window.
 *
 * Roadmap Fase 5 (5.2): "Incorporar creación, cancelación y
 * auditoría con permiso específico." The cancel is SOFT — the row
 * stays in the table with `status='cancelled'`, `cancelledAt`,
 * `cancelledByUserId`, and `cancellationReason`. Evidence is
 * preserved (the suppression policy still has an audit trail).
 *
 * Cancelling a window that is already 'cancelled' or 'completed'
 * returns 409 (no double-cancel).
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  cancellationReason: z.string().min(1).max(4096),
});

export async function DELETE(
  req: Request,
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

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      { error: 'invalid_body', details: (e as Error).message },
      { status: 400 },
    );
  }

  const existing = await prisma.maintenanceWindow.findUnique({ where: { id } });
  if (existing === null) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (existing.tenantId !== user.tenantId) {
    // Tenant isolation: a t_A user MUST NOT see or cancel a t_B row.
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (existing.status !== 'scheduled') {
    return NextResponse.json(
      {
        error: 'already_terminal',
        currentStatus: existing.status,
      },
      { status: 409 },
    );
  }

  const cancelled = await prisma.maintenanceWindow.update({
    where: { id },
    data: {
      status: 'cancelled',
      cancelledAt: new Date(),
      cancelledByUserId: user.id,
      cancellationReason: body.cancellationReason,
    },
  });

  return NextResponse.json({
    id: cancelled.id,
    status: cancelled.status,
    cancelledAt: cancelled.cancelledAt?.toISOString() ?? null,
    cancelledByUserId: cancelled.cancelledByUserId,
    cancellationReason: cancelled.cancellationReason,
  });
}
