import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@ftth-copilot/db';
import { getCurrentUser } from '@/lib/auth/server';
import { hasPermission } from '@/lib/auth/permissions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/security/access — access audit trail (successful logins and failed
 * auth attempts) for the tenant's devices.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!hasPermission(user.role, 'view_network')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const category = req.nextUrl.searchParams.get('category');
  const limitParam = Number.parseInt(req.nextUrl.searchParams.get('limit') ?? '100', 10);
  const limit = Number.isFinite(limitParam) ? Math.min(500, Math.max(1, limitParam)) : 100;

  const events = await prisma.deviceEvent.findMany({
    where: {
      tenantId: user.tenantId,
      category:
        category === 'access' || category === 'auth_failure'
          ? category
          : { in: ['access', 'auth_failure'] },
    },
    orderBy: { occurredAt: 'desc' },
    take: limit,
    select: {
      id: true,
      sourceIp: true,
      category: true,
      message: true,
      occurredAt: true,
    },
  });

  return NextResponse.json({ events, count: events.length });
}
