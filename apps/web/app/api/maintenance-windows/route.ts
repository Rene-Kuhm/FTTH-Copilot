import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@ftth-copilot/db';
import { getCurrentUser } from '@/lib/auth/server';
import { hasPermission } from '@/lib/auth/permissions';
import {
  findOverlap,
  validateMaintenanceInput,
  type MaintenanceWindowInput,
} from '@/lib/maintenance/overlap';

/**
 * POST /api/maintenance-windows — create a maintenance window.
 *
 * Roadmap Fase 5 (5.1 + 5.2). Aditivo (no existing table changes).
 * Requires `manage_maintenance` permission. Rejects overlapping
 * windows of the same tenant with 409 (deterministic, no silent
 * merge — evidence stays intact).
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  title: z.string().min(1).max(256),
  description: z.string().max(4096).optional(),
  startUtc: z.string().datetime(),
  endUtc: z.string().datetime(),
  timezone: z.string().min(1).max(64),
  scope: z.object({
    kind: z.enum(['tenant', 'connection', 'device']),
    id: z.string().min(1).max(128).optional(),
  }),
});

export async function POST(req: Request): Promise<NextResponse> {
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

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      { error: 'invalid_body', details: (e as Error).message },
      { status: 400 },
    );
  }

  const startUtcMs = new Date(body.startUtc).getTime();
  const endUtcMs = new Date(body.endUtc).getTime();
  const input: MaintenanceWindowInput = {
    startUtcMs,
    endUtcMs,
    timezone: body.timezone,
    scope: body.scope,
  };
  try {
    validateMaintenanceInput(input);
  } catch (e) {
    return NextResponse.json(
      { error: 'invalid_window', details: (e as Error).message },
      { status: 400 },
    );
  }

  // Overlap detection — only against non-cancelled windows of the
  // same tenant.
  const existing = await prisma.maintenanceWindow.findMany({
    where: { tenantId: user.tenantId, status: { not: 'cancelled' } },
  });
  const overlap = findOverlap(
    { startUtcMs, endUtcMs },
    existing.map((w) => ({
      id: w.id,
      tenantId: w.tenantId,
      title: w.title,
      description: w.description,
      startUtcMs: w.startUtc.getTime(),
      endUtcMs: w.endUtc.getTime(),
      timezone: w.timezone,
      scope: { kind: 'tenant' as const },
      status: w.status as 'scheduled' | 'cancelled' | 'completed',
      createdByUserId: w.createdByUserId,
      createdAt: w.createdAt.toISOString(),
      updatedAt: w.updatedAt.toISOString(),
      cancelledAt: w.cancelledAt?.toISOString() ?? null,
      cancelledByUserId: w.cancelledByUserId,
      cancellationReason: w.cancellationReason,
    })),
  );
  if (overlap !== null) {
    return NextResponse.json(
      {
        error: 'overlap',
        overlappingWindowId: overlap.id,
        overlappingWindowTitle: overlap.title,
        overlappingStartUtc: new Date(overlap.startUtcMs).toISOString(),
        overlappingEndUtc: new Date(overlap.endUtcMs).toISOString(),
      },
      { status: 409 },
    );
  }

  const created = await prisma.maintenanceWindow.create({
    data: {
      tenantId: user.tenantId,
      title: body.title,
      description: body.description ?? null,
      scopeJson: JSON.stringify(body.scope),
      startUtc: new Date(startUtcMs),
      endUtc: new Date(endUtcMs),
      timezone: body.timezone,
      status: 'scheduled',
      createdByUserId: user.id,
    },
  });

  return NextResponse.json(
    {
      id: created.id,
      tenantId: created.tenantId,
      title: created.title,
      description: created.description,
      scope: body.scope,
      startUtc: created.startUtc.toISOString(),
      endUtc: created.endUtc.toISOString(),
      timezone: created.timezone,
      status: created.status,
      createdByUserId: created.createdByUserId,
      createdAt: created.createdAt.toISOString(),
    },
    { status: 201 },
  );
}

/**
 * GET /api/maintenance-windows — list maintenance windows
 * intersecting a UTC range (default: now ± 24 h).
 *
 * Roadmap 5.1: "Definir ventanas con tenant, equipos/alcance
 * explícito, inicio/fin UTC, zona horaria de presentación, motivo,
 * autor y estado." The list is the canonical view the
 * investigation card consumes.
 */
export async function GET(req: Request): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const url = new URL(req.url);
  const now = Date.now();
  const fromMs = url.searchParams.get('from') !== null
    ? new Date(url.searchParams.get('from')!).getTime()
    : now - 24 * 60 * 60 * 1000;
  const toMs = url.searchParams.get('to') !== null
    ? new Date(url.searchParams.get('to')!).getTime()
    : now + 24 * 60 * 60 * 1000;

  const rows = await prisma.maintenanceWindow.findMany({
    where: {
      tenantId: user.tenantId,
      startUtc: { lt: new Date(toMs) },
      endUtc: { gt: new Date(fromMs) },
    },
    orderBy: { startUtc: 'asc' },
  });

  return NextResponse.json({
    windows: rows.map((w) => ({
      id: w.id,
      tenantId: w.tenantId,
      title: w.title,
      description: w.description,
      scope: JSON.parse(w.scopeJson),
      startUtc: w.startUtc.toISOString(),
      endUtc: w.endUtc.toISOString(),
      timezone: w.timezone,
      status: w.status,
      createdByUserId: w.createdByUserId,
      createdAt: w.createdAt.toISOString(),
      updatedAt: w.updatedAt.toISOString(),
      cancelledAt: w.cancelledAt?.toISOString() ?? null,
      cancelledByUserId: w.cancelledByUserId,
      cancellationReason: w.cancellationReason,
    })),
  });
}
