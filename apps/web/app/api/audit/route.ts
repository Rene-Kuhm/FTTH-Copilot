/**
 * GET /api/audit
 *
 * Paginated audit log for the current tenant.
 * Operators and above can see all events; Members see only their own.
 *
 * Query params:
 *   page=1         — 1-indexed page number
 *   limit=50       — rows per page (max 200)
 *   category=      — filter by AuditCategory (optional)
 *   actorId=       — filter by actor
 *   resourceType=   — filter by resource type
 *   outcome=       — SUCCESS | FAILURE
 *   from=          — ISO timestamp (default: 7 days ago)
 *   to=            — ISO timestamp (default: now)
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@ftth-copilot/db';
import { getCurrentUser } from '@/lib/auth/server';
import { hasPermission } from '@/lib/auth/permissions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CATEGORIES = ['AUTH', 'USER_MANAGEMENT', 'INCIDENT', 'MAINTENANCE', 'CONNECTOR', 'NETWORK', 'NOTIFICATION', 'CONFIGURATION', 'AI', 'SYSTEM'] as const;
const OUTCOMES = ['SUCCESS', 'FAILURE'] as const;

interface AuditLogRow {
  id: string;
  actorId: string;
  actorEmail: string | null;
  actorRole: string | null;
  category: string;
  action: string;
  resourceType: string;
  resourceId: string;
  outcome: string;
  metadata: Record<string, unknown>;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!hasPermission(user.role, 'view_network')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const url = new URL(req.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10));
  const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit') ?? '50', 10)));
  const offset = (page - 1) * limit;

  // Members see only their own events; operators+ see all tenant events.
  const isOperator = hasPermission(user.role, 'manage_maintenance');

  const where: Record<string, unknown> = {
    tenantId: user.tenantId,
    ...(isOperator ? {} : { actorId: user.id }),
  };

  const catParam = url.searchParams.get('category');
  if (catParam && CATEGORIES.includes(catParam as typeof CATEGORIES[number])) {
    (where as Record<string, unknown>).category = catParam;
  }

  const actorIdParam = url.searchParams.get('actorId');
  if (actorIdParam) (where as Record<string, unknown>).actorId = actorIdParam;

  const resTypeParam = url.searchParams.get('resourceType');
  if (resTypeParam) (where as Record<string, unknown>).resourceType = resTypeParam;

  const outcomeParam = url.searchParams.get('outcome');
  if (outcomeParam && OUTCOMES.includes(outcomeParam as typeof OUTCOMES[number])) {
    (where as Record<string, unknown>).outcome = outcomeParam;
  }

  const fromParam = url.searchParams.get('from');
  const toParam = url.searchParams.get('to');
  if (fromParam || toParam) {
    (where as Record<string, unknown>).createdAt = {
      ...(fromParam ? { gte: new Date(fromParam) } : {}),
      ...(toParam ? { lte: new Date(toParam) } : {}),
    };
  } else {
    // Default: last 30 days
    (where as Record<string, unknown>).createdAt = { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) };
  }

  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: offset,
      take: limit,
    }),
    prisma.auditLog.count({ where }),
  ]);

  // Group by day for display
  const byDay: Record<string, AuditLogRow[]> = {};
  for (const row of rows) {
    const day = row.createdAt.toISOString().slice(0, 10);
    if (!byDay[day]) byDay[day] = [];
    byDay[day].push({
      id: row.id,
      actorId: row.actorId,
      actorEmail: row.actorEmail,
      actorRole: row.actorRole,
      category: row.category,
      action: row.action,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      outcome: row.outcome,
      metadata: row.metadata as Record<string, unknown>,
      ipAddress: row.ipAddress,
      userAgent: row.userAgent,
      createdAt: row.createdAt,
    });
  }

  return NextResponse.json({
    rows: rows.map((r) => ({
      id: r.id,
      actorId: r.actorId,
      actorEmail: r.actorEmail,
      actorRole: r.actorRole,
      category: r.category,
      action: r.action,
      resourceType: r.resourceType,
      resourceId: r.resourceId,
      outcome: r.outcome,
      metadata: r.metadata,
      ipAddress: r.ipAddress,
      userAgent: r.userAgent,
      createdAt: r.createdAt.toISOString(),
    })),
    byDay,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
    generatedAt: new Date().toISOString(),
  });
}
