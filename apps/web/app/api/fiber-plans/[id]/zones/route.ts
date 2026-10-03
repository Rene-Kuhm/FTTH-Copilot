/**
 * GET    /api/fiber-plans/[id]/zones      — list zones for a plan
 * POST   /api/fiber-plans/[id]/zones      — create a zone
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@ftth-copilot/db';
import { getCurrentUser } from '@/lib/auth/server';
import { hasPermission } from '@/lib/auth/permissions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

const createZoneSchema = z.object({
  name: z.string().trim().min(1).max(255),
  description: z.string().trim().max(1000).optional(),
  color: z.string().trim().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
});

/** GET /api/fiber-plans/[id]/zones */
export async function GET(_req: Request, { params }: RouteContext): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!hasPermission(user.role, 'view_network')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const { id } = await params;

  // Verify plan belongs to tenant
  const plan = await prisma.fiberPlan.findFirst({
    where: { id, tenantId: user.tenantId },
    select: { id: true },
  });
  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 });

  const zones = await prisma.planZone.findMany({
    where: { planId: plan.id },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      name: true,
      description: true,
      color: true,
      createdAt: true,
      _count: { select: { markers: true } },
    },
  });

  return NextResponse.json({
    zones: zones.map((z) => ({ ...z, markerCount: z._count.markers, _count: undefined })),
    count: zones.length,
  });
}

/** POST /api/fiber-plans/[id]/zones */
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
  const parsed = createZoneSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const zone = await prisma.planZone.create({
    data: {
      tenantId: user.tenantId,
      planId: plan.id,
      name: parsed.data.name,
      description: parsed.data.description || null,
      color: parsed.data.color || '#6366F1',
    },
    select: {
      id: true,
      name: true,
      description: true,
      color: true,
      planId: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ zone }, { status: 201 });
}
