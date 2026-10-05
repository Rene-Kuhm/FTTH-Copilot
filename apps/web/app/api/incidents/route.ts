import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@ftth-copilot/db';
import { getCurrentUser } from '@/lib/auth/server';
import { hasPermission } from '@/lib/auth/permissions';
import { auditIncident } from '@ftth-copilot/soc';
import { buildAuditContext } from '@/lib/audit-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!hasPermission(user.role, 'manage_incidents')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = z.object({
    deviceKind: z.enum(['OLT', 'ONU']),
    deviceId: z.string().min(1),
    title: z.string().min(1).max(256),
    description: z.string().max(4096).optional(),
    severity: z.enum(['warning', 'critical']).default('warning'),
  }).safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { deviceKind, deviceId, title, description, severity } = parsed.data;

  // Check for existing open incident for same device
  const existing = await prisma.incident.findFirst({
    where: { tenantId: user.tenantId, deviceKind, deviceId, status: { in: ['open', 'acknowledged'] } },
  });
  if (existing) {
    return NextResponse.json({ error: 'An active incident already exists for this device', existingId: existing.id }, { status: 409 });
  }

  const created = await prisma.incident.create({
    data: {
      tenantId: user.tenantId,
      deviceKind,
      deviceId,
      title,
      description: description ?? '',
      severity,
      status: 'open',
    },
  });

  // Audit log
  await auditIncident.created(
    buildAuditContext(req as unknown as import('next/server').NextRequest, user),
    created.id,
  );

  return NextResponse.json({ incident: created }, { status: 201 });
}



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
