import { NextRequest, NextResponse } from 'next/server';
import { prisma, type Prisma } from '@ftth-copilot/db';
import { getCurrentUser } from '@/lib/auth/server';
import { hasPermission } from '@/lib/auth/permissions';
import {
  clampLimit,
  cursorFilter,
  decodeCursor,
  encodeCursor,
} from '@/lib/api/pagination';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Predictions are detected alerts that have not been resolved yet. The default
 * scope is therefore already the bounded one, but the page still had no limit
 * and no way to reach anything past the first N rows.
 *
 * `status=all` reopens the historical view, where alerts accumulate forever.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const searchParams = new URL(req.url).searchParams;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!hasPermission(user.role, 'view_network')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const scope = searchParams.get('status') ?? 'unresolved';
  const statusFilter: Prisma.EnumAlertStatusFilter<"DetectedAlert"> =
    scope === 'all'
      ? { in: ['open', 'acknowledged', 'resolved'] }
      : scope === 'resolved'
        ? { in: ['resolved'] }
        : { in: ['open', 'acknowledged'] };

  const limit = clampLimit(searchParams.get('limit'));
  const cursor = decodeCursor(searchParams.get('cursor'));

  const rows = await prisma.detectedAlert.findMany({
    where: {
      tenantId: user.tenantId,
      status: statusFilter,
      ...cursorFilter(cursor),
    },
    orderBy: [{ lastSeenAt: 'desc' }, { id: 'desc' }],
    // One extra row tells us whether another page exists without a COUNT query.
    take: limit + 1,
    select: {
      id: true,
      kind: true,
      severity: true,
      deviceKind: true,
      deviceId: true,
      title: true,
      description: true,
      etaMs: true,
      confidence: true,
      status: true,
      firstSeenAt: true,
      lastSeenAt: true,
    },
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page.at(-1);

  return NextResponse.json({
    predictions: page,
    count: page.length,
    page: {
      scope,
      hasMore,
      nextCursor: hasMore && last ? encodeCursor(last) : null,
    },
  });
}