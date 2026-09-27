/**
 * PATCH  /api/fiber-plans/[id]/markers/[markerId] — update an unzoned marker
 * DELETE /api/fiber-plans/[id]/markers/[markerId] — delete a marker (zoned or unzoned)
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@ftth-copilot/db';
import { getCurrentUser } from '@/lib/auth/server';
import { hasPermission } from '@/lib/auth/permissions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string; markerId: string }> };

const VALID_DEVICE_KINDS = ['OLT', 'PON_PORT', 'SPLITTER', 'CTO', 'ONU'] as const;

const updateSchema = z.object({
  label: z.string().trim().min(1).max(255).optional(),
  deviceKind: z.enum(VALID_DEVICE_KINDS).optional().nullable(),
  deviceId: z.string().trim().max(255).optional().nullable(),
  xPercent: z.number().min(0).max(100).optional(),
  yPercent: z.number().min(0).max(100).optional(),
  zoneId: z.string().cuid().optional().nullable(),
});

/** PATCH /api/fiber-plans/[id]/markers/[markerId] */
export async function PATCH(req: Request, { params }: RouteContext): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!hasPermission(user.role, 'view_network')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const { id, markerId } = await params;

  const plan = await prisma.fiberPlan.findFirst({
    where: { id, tenantId: user.tenantId },
    select: { id: true },
  });
  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 });

  const marker = await prisma.planMarker.findFirst({
    where: { id: markerId, tenantId: user.tenantId },
    select: { id: true, zoneId: true },
  });
  if (!marker) return NextResponse.json({ error: 'Marker not found' }, { status: 404 });

  // If zoneId is provided, verify the zone belongs to this plan
  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 });
  }

  if (parsed.data.zoneId != null) {
    const zone = await prisma.planZone.findFirst({
      where: { id: parsed.data.zoneId, planId: plan.id, tenantId: user.tenantId },
      select: { id: true },
    });
    if (!zone) {
      return NextResponse.json({ error: 'Zone not found' }, { status: 400 });
    }
  }

  const updated = await prisma.planMarker.update({
    where: { id: marker.id },
    data: {
      ...(parsed.data.label !== undefined && { label: parsed.data.label }),
      ...(parsed.data.deviceKind !== undefined && { deviceKind: parsed.data.deviceKind }),
      ...(parsed.data.deviceId !== undefined && { deviceId: parsed.data.deviceId }),
      ...(parsed.data.xPercent !== undefined && { xPercent: parsed.data.xPercent }),
      ...(parsed.data.yPercent !== undefined && { yPercent: parsed.data.yPercent }),
      ...(parsed.data.zoneId !== undefined && { zoneId: parsed.data.zoneId }),
    },
  });

  return NextResponse.json({ marker: updated });
}

/** DELETE /api/fiber-plans/[id]/markers/[markerId] */
export async function DELETE(_req: Request, { params }: RouteContext): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!hasPermission(user.role, 'view_network')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const { id, markerId } = await params;

  const plan = await prisma.fiberPlan.findFirst({
    where: { id, tenantId: user.tenantId },
    select: { id: true },
  });
  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 });

  const marker = await prisma.planMarker.findFirst({
    where: { id: markerId, tenantId: user.tenantId },
    select: { id: true, zoneId: true },
  });
  if (!marker) return NextResponse.json({ error: 'Marker not found' }, { status: 404 });

  // Verify the marker's zone belongs to this plan (if zoned)
  if (marker.zoneId) {
    const zone = await prisma.planZone.findFirst({
      where: { id: marker.zoneId, planId: plan.id },
      select: { id: true },
    });
    if (!zone) return NextResponse.json({ error: 'Marker not found in this plan' }, { status: 404 });
  }

  await prisma.planMarker.delete({ where: { id: marker.id } });

  return NextResponse.json({ deleted: true });
}
