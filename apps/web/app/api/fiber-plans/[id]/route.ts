/**
 * GET    /api/fiber-plans/[id] — get a single plan with zones and markers
 * DELETE /api/fiber-plans/[id] — delete a plan and its zones/markers
 */
import { NextResponse } from 'next/server';
import { unlink } from 'fs/promises';
import { join } from 'path';
import { prisma } from '@ftth-copilot/db';
import { getCurrentUser } from '@/lib/auth/server';
import { hasPermission } from '@/lib/auth/permissions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

/** GET /api/fiber-plans/[id] */
export async function GET(_req: Request, { params }: RouteContext): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!hasPermission(user.role, 'view_network')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const { id } = await params;

  const plan = await prisma.fiberPlan.findFirst({
    where: { id, tenantId: user.tenantId },
    select: {
      id: true,
      name: true,
      description: true,
      fileUrl: true,
      mimeType: true,
      widthPx: true,
      heightPx: true,
      fileSizeBytes: true,
      connectionId: true,
      createdAt: true,
      updatedAt: true,
      zones: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          name: true,
          description: true,
          color: true,
          createdAt: true,
          _count: { select: { markers: true } },
          markers: {
            select: {
              id: true,
              label: true,
              deviceKind: true,
              deviceId: true,
              xPercent: true,
              yPercent: true,
              createdAt: true,
            },
          },
        },
      },
    },
  });

  if (!plan) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({
    plan: {
      ...plan,
      fileSizeBytes: plan.fileSizeBytes?.toString(),
      zones: plan.zones.map((z) => ({
        ...z,
        markerCount: z._count.markers,
        _count: undefined,
      })),
    },
  });
}

/** DELETE /api/fiber-plans/[id] */
export async function DELETE(_req: Request, { params }: RouteContext): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!hasPermission(user.role, 'view_network')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const { id } = await params;

  const plan = await prisma.fiberPlan.findFirst({
    where: { id, tenantId: user.tenantId },
    select: { id: true, fileUrl: true },
  });

  if (!plan) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Delete the file from disk
  const filePath = join(process.cwd(), 'public', plan.fileUrl);
  try {
    await unlink(filePath);
  } catch {
    // File may not exist; proceed with DB deletion
  }

  await prisma.fiberPlan.delete({ where: { id: plan.id } });

  return NextResponse.json({ deleted: true });
}
