/**
 * GET    /api/fiber-plans/[id]/zones/[zoneId]/markers — list markers in a zone
 * POST   /api/fiber-plans/[id]/zones/[zoneId]/markers — create a marker
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@ftth-copilot/db';
import { getCurrentUser } from '@/lib/auth/server';
import { hasPermission } from '@/lib/auth/permissions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string; zoneId: string }> };

const VALID_DEVICE_KINDS = ['OLT', 'PON_PORT', 'SPLITTER', 'CTO', 'ONU'] as const;

const createMarkerSchema = z.object({
  label: z.string().trim().min(1).max(255),
  deviceKind: z.enum(VALID_DEVICE_KINDS).optional(),
  deviceId: z.string().trim().max(255).optional(),
  xPercent: z.number().min(0).max(100),
  yPercent: z.number().min(0).max(100),
});

/** GET /api/fiber-plans/[id]/zones/[zoneId]/markers */
export async function GET(_req: Request, { params }: RouteContext): Promise<NextResponse> {
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

  const markers = await prisma.planMarker.findMany({
    where: { zoneId: zone.id },
    orderBy: { createdAt: 'asc' },
  });

  return NextResponse.json({ markers, count: markers.length });
}

/** POST /api/fiber-plans/[id]/zones/[zoneId]/markers */
export async function POST(req: Request, { params }: RouteContext): Promise<NextResponse> {
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
  const parsed = createMarkerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const marker = await prisma.planMarker.create({
    data: {
      tenantId: user.tenantId,
      zoneId: zone.id,
      label: parsed.data.label,
      deviceKind: parsed.data.deviceKind || null,
      deviceId: parsed.data.deviceId || null,
      xPercent: parsed.data.xPercent,
      yPercent: parsed.data.yPercent,
    },
  });

  return NextResponse.json({ marker }, { status: 201 });
}
