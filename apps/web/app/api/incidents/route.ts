import { NextResponse } from 'next/server';
import { prisma } from '@ftth-copilot/db';
import { getCurrentUser } from '@/lib/auth/server';
import { hasPermission } from '@/lib/auth/permissions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!hasPermission(user.role, 'view_network')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const incidents = await prisma.incident.findMany({
    // Fase D WU4: include `resolved` so the operator can confirm historic
    // incidents from the panel. Open/acknowledged ones still rank first
    // (same severity + lastSeenAt ordering).
    where: { tenantId: user.tenantId, status: { in: ['open', 'acknowledged', 'resolved'] } },
    orderBy: [{ severity: 'desc' }, { lastSeenAt: 'desc' }],
    select: {
      id: true,
      deviceKind: true,
      deviceId: true,
      title: true,
      description: true,
      severity: true,
      status: true,
      firstSeenAt: true,
      lastSeenAt: true,
      _count: { select: { alerts: true } },
    },
  });

  const result = incidents.map((incident) => ({
    id: incident.id,
    deviceKind: incident.deviceKind,
    deviceId: incident.deviceId,
    title: incident.title,
    description: incident.description,
    severity: incident.severity,
    status: incident.status,
    firstSeenAt: incident.firstSeenAt,
    lastSeenAt: incident.lastSeenAt,
    alertCount: incident._count.alerts,
  }));

  return NextResponse.json({ incidents: result, count: result.length });
}
