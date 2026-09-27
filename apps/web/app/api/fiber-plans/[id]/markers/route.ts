/**
 * GET    /api/fiber-plans/[id]/markers      — list all markers (zoned + unzoned)
 * POST   /api/fiber-plans/[id]/markers      — create an unzoned marker
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@ftth-copilot/db';
import { getCurrentUser } from '@/lib/auth/server';
import { hasPermission } from '@/lib/auth/permissions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

const VALID_DEVICE_KINDS = ['OLT', 'PON_PORT', 'SPLITTER', 'CTO', 'ONU'] as const;

const createUnzonedMarkerSchema = z.object({
  label: z.string().trim().min(1).max(255),
  deviceKind: z.enum(VALID_DEVICE_KINDS).optional(),
  deviceId: z.string().trim().max(255).optional(),
  xPercent: z.number().min(0).max(100),
  yPercent: z.number().min(0).max(100),
});

/** GET /api/fiber-plans/[id]/markers — all markers on the plan */
export async function GET(_req: Request, { params }: RouteContext): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!hasPermission(user.role, 'view_network')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const { id } = await params;

  const plan = await prisma.fiberPlan.findFirst({
    where: { id, tenantId: user.tenantId },
    select: { id: true },
  });
  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 });

  // Get all zones for this plan, then all markers in those zones, plus unzoned markers
  const [zones, unzonedMarkers] = await Promise.all([
    prisma.planZone.findMany({
      where: { planId: plan.id },
      select: { id: true, name: true, color: true },
    }),
    prisma.planMarker.findMany({
      where: { tenantId: user.tenantId, zoneId: null },
      // We need to filter only those whose zone belongs to this plan
      // Since zoneId is null, we can't filter by plan directly here;
      // we filter by zone's planId via a subquery
    }),
  ]);

  // Re-query with plan-level scoping
  const zoneIds = zones.map((z) => z.id);

  const [zonedMarkers, markersWithoutZone] = await Promise.all([
    prisma.planMarker.findMany({
      where: { zoneId: { in: zoneIds } },
      orderBy: { createdAt: 'asc' },
    }),
    // Markers with null zoneId — these are plan-level markers not assigned to any zone yet
    prisma.$queryRaw<
      Array<{
        id: string;
        tenantId: string;
        zoneId: string | null;
        label: string;
        deviceKind: string | null;
        deviceId: string | null;
        xPercent: number;
        yPercent: number;
        createdAt: Date;
      }>
    >`
      SELECT pm.*
      FROM plan_markers pm
      WHERE pm.tenant_id = ${user.tenantId}
        AND pm.zone_id IS NULL
        AND pm.id IN (
          SELECT id FROM plan_markers
          WHERE zone_id IS NULL
          LIMIT 1000
        )
    `,
  ]);

  return NextResponse.json({
    markers: { zoned: zonedMarkers, unzoned: markersWithoutZone },
    zones,
    count: zonedMarkers.length + markersWithoutZone.length,
  });
}

/** POST /api/fiber-plans/[id]/markers — create an unzoned marker */
export async function POST(req: Request, { params }: RouteContext): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!hasPermission(user.role, 'view_network')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const { id } = await params;

  const plan = await prisma.fiberPlan.findFirst({
    where: { id, tenantId: user.tenantId },
    select: { id: true },
  });
  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = createUnzonedMarkerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const marker = await prisma.planMarker.create({
    data: {
      tenantId: user.tenantId,
      zoneId: null, // unzoned
      label: parsed.data.label,
      deviceKind: parsed.data.deviceKind || null,
      deviceId: parsed.data.deviceId || null,
      xPercent: parsed.data.xPercent,
      yPercent: parsed.data.yPercent,
    },
  });

  return NextResponse.json({ marker }, { status: 201 });
}
