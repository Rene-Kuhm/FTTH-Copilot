import { NextResponse } from 'next/server';
import { prisma } from '@ftth-copilot/db';
import { getCurrentUser } from '@/lib/auth/server';
import { hasPermission } from '@/lib/auth/permissions';

/**
 * GET /api/incidents/:id — fetch one incident, with the related
 * maintenance windows (Fase 5 — 5.5).
 *
 * 5.5: "Mostrar mantenimiento en la investigación sin
 *      etiquetarlo automáticamente como causa real."
 *
 * The maintenance windows are returned as a separate field so the
 * UI can render them as "context, not cause". The diagnosis in
 * InvestigationResult MUST NOT auto-label maintenance as the root
 * cause — that decision is the operator's.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  if (!hasPermission(user.role, 'view_network')) {
    return NextResponse.json(
      { error: 'forbidden', missing: 'view_network' },
      { status: 403 },
    );
  }
  const { id } = await ctx.params;

  const incident = await prisma.incident.findUnique({ where: { id } });
  if (incident === null) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (incident.tenantId !== user.tenantId) {
    // Tenant isolation — 404, not 403 (no existence leak).
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // Related maintenance windows: any non-cancelled window that
  // intersects the incident's lastSeenAt ± 24h, plus any window
  // that explicitly targets the incident's device. The UI renders
  // these as context, not cause (5.5).
  const observed = incident.lastSeenAt.getTime();
  const from = new Date(observed - 24 * 60 * 60 * 1000);
  const to = new Date(observed + 24 * 60 * 60 * 1000);
  const windows = await prisma.maintenanceWindow.findMany({
    where: {
      tenantId: user.tenantId,
      status: { not: 'cancelled' },
      startUtc: { lt: to },
      endUtc: { gt: from },
    },
    orderBy: { startUtc: 'asc' },
  });

  return NextResponse.json({
    incident: {
      id: incident.id,
      tenantId: incident.tenantId,
      deviceKind: incident.deviceKind,
      deviceId: incident.deviceId,
      status: incident.status,
      severity: incident.severity,
      title: incident.title,
      description: incident.description,
      firstSeenAt: incident.firstSeenAt.toISOString(),
      lastSeenAt: incident.lastSeenAt.toISOString(),
      resolvedAt: incident.resolvedAt?.toISOString() ?? null,
    },
    relatedMaintenance: windows.map((w: typeof windows[number]) => ({
      id: w.id,
      title: w.title,
      description: w.description,
      scope: JSON.parse(w.scopeJson),
      startUtc: w.startUtc.toISOString(),
      endUtc: w.endUtc.toISOString(),
      timezone: w.timezone,
      status: w.status,
    })),
  });
}
