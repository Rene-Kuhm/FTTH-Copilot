/**
 * PATCH  /api/fiber-plans/[id]/zones/[zoneId] — update a zone
 * DELETE /api/fiber-plans/[id]/zones/[zoneId] — delete a zone
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@ftth-copilot/db';
import { getCurrentUser } from '@/lib/auth/server';
import { hasPermission } from '@/lib/auth/permissions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string; zoneId: string }> };

const updateSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  description: z.string().trim().max(1000).optional().nullable(),
  color: z.string().trim().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
});

/** PATCH /api/fiber-plans/[id]/zones/[zoneId] */
export async function PATCH(req: Request, { params }: RouteContext): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!hasPermission(user.role, 'view_network')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const { id, zoneId } = await params;

  const plan = await prisma.fiberPlan.findFirst({
    where: { id, tenantId: user.tenantId },
    select: { id: true },
  });
  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 });

  const zone = await prisma.planZone.findFirst({
    where: { id: zoneId, planId: plan.id, tenantId: user.tenantId },
    select: { id: true },
  });
  if (!zone) return NextResponse.json({ error: 'Zone not found' }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 });
  }

  const updated = await prisma.planZone.update({
    where: { id: zone.id },
    data: parsed.data,
    select: { id: true, name: true, description: true, color: true, planId: true, createdAt: true },
  });

  return NextResponse.json({ zone: updated });
}

/** DELETE /api/fiber-plans/[id]/zones/[zoneId] */
export async function DELETE(_req: Request, { params }: RouteContext): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!hasPermission(user.role, 'view_network')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const { id, zoneId } = await params;

  const plan = await prisma.fiberPlan.findFirst({
    where: { id, tenantId: user.tenantId },
    select: { id: true },
  });
  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 });

  const zone = await prisma.planZone.findFirst({
    where: { id: zoneId, planId: plan.id, tenantId: user.tenantId },
    select: { id: true },
  });
  if (!zone) return NextResponse.json({ error: 'Zone not found' }, { status: 404 });

  await prisma.planZone.delete({ where: { id: zone.id } });

  return NextResponse.json({ deleted: true });
}
