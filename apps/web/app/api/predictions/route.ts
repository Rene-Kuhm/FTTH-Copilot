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

  const predictions = await prisma.detectedAlert.findMany({
    where: { tenantId: user.tenantId, status: { in: ['open', 'acknowledged'] } },
    orderBy: [{ severity: 'desc' }, { lastSeenAt: 'desc' }],
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

  return NextResponse.json({ predictions, count: predictions.length });
}
