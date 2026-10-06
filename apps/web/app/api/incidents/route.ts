import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma, type AlertStatus, type Prisma } from '@ftth-copilot/db';
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



/**
 * Page size for the incident list.
 *
 * The default view only returns unresolved incidents, which is bounded by real
 * outstanding work rather than by how long the system has been running.
 * Resolved incidents accumulate forever, so they are reachable only through an
 * explicit filter, paged with a cursor.
 */
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Opaque cursor over the (lastSeenAt, id) ordering, which is the exact order
 * the query uses.
 *
 * Ordering by lastSeenAt rather than severity keeps the cursor expressible:
 * Prisma rejects `<` on enum fields, so a severity-first cursor cannot be
 * written as a typed query. It also lines the query up with the existing
 * @@index([tenantId, status, lastSeenAt]) instead of sorting after it.
 *
 * Offset pagination would drift whenever an incident is acknowledged between
 * two requests, and it degrades on large offsets, which is the case that
 * motivated a cursor.
 */
function encodeCursor(incident: {
  lastSeenAt: Date;
  id: string;
  _count?: unknown;
}): string {
  return Buffer.from(
    JSON.stringify({
      l: incident.lastSeenAt.toISOString(),
      i: incident.id,
    }),
    'utf8',
  ).toString('base64url');
}

function decodeCursor(cursor: string | null): { lastSeenAt: Date; id: string } | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    ) as { l?: unknown; i?: unknown };
    if (typeof parsed.l !== 'string' || typeof parsed.i !== 'string') {
      return null;
    }
    const lastSeenAt = new Date(parsed.l);
    if (Number.isNaN(lastSeenAt.getTime())) return null;
    return { lastSeenAt, id: parsed.i };
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const searchParams = new URL(req.url).searchParams;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!hasPermission(user.role, 'view_network')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  // Default to unresolved only. Returning every incident ever recorded meant
  // the response grew without bound and, worse, could crowd unresolved ones out
  // of the operator's view.
  const scope = searchParams.get('status') ?? 'unresolved';
  const resolved = scope === 'all';
  const statusFilter: { in: AlertStatus[] } = resolved
    ? { in: ['open', 'acknowledged', 'resolved'] }
    : scope === 'resolved'
      ? { in: ['resolved'] }
      : { in: ['open', 'acknowledged'] };

  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number.parseInt(searchParams.get('limit') ?? '', 10) || DEFAULT_LIMIT),
  );
  const cursor = decodeCursor(searchParams.get('cursor'));

  // Lexicographic continuation of (lastSeenAt desc, id desc).
  const cursorFilter: Prisma.IncidentWhereInput = cursor
    ? {
        OR: [
          { lastSeenAt: { lt: cursor.lastSeenAt } },
          { lastSeenAt: cursor.lastSeenAt, id: { lt: cursor.id } },
        ],
      }
    : {};

  const rows = await prisma.incident.findMany({
    where: {
      tenantId: user.tenantId,
      status: statusFilter,
      ...cursorFilter,
    },
    orderBy: [{ lastSeenAt: 'desc' }, { id: 'desc' }],
    // One extra row tells us whether another page exists without a count query.
    take: limit + 1,
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

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  const result = page.map((incident) => ({
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

  const last = page.at(-1);

  return NextResponse.json({
    incidents: result,
    count: result.length,
    page: {
      scope,
      hasMore,
      nextCursor: hasMore && last ? encodeCursor(last) : null,
    },
  });
}
