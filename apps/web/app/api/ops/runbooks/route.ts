import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@ftth-copilot/db';
import { topologyNodeKindSchema } from '@ftth-copilot/shared';
import { getCurrentUser } from '@/lib/auth/server';
import { hasPermission } from '@/lib/auth/permissions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/ops/runbooks
 *
 * Returns runbooks matched to the current alert/incident context.
 * Match priority:
 *   1. Exact (deviceKind + deviceId + alertKind + severity)
 *   2. (deviceKind + alertKind + severity) — any device of that kind
 *   3. (deviceKind + alertKind) — any severity
 *   4. (deviceKind) — any alert on that device kind
 *   5. (alertKind + severity) — any device
 *
 * Also returns confirmed incident history as derived runbook content.
 *
 * Query params:
 *   deviceKind=OLT
 *   deviceId=OLT-01
 *   alertKind=onu_failure
 *   severity=critical
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!hasPermission(user.role, 'view_network')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const url = new URL(req.url);
  const deviceKindParam = url.searchParams.get('deviceKind') ?? undefined;
  const deviceId = url.searchParams.get('deviceId') ?? undefined;
  const alertKind = url.searchParams.get('alertKind') ?? undefined;
  const severity = url.searchParams.get('severity') ?? undefined;

  // Safe enum parse
  const deviceKind = deviceKindParam
    ? (topologyNodeKindSchema.safeParse(deviceKindParam).success ? deviceKindParam : undefined)
    : undefined;

  // Build OR conditions for runbook matching
   
  const orConditions: any[] = [];

  if (deviceKind && deviceId && alertKind && severity) {
    orConditions.push({ deviceKind, deviceId, alertKind, severity });
  }
  if (deviceKind && alertKind && severity) {
    orConditions.push({ deviceKind, deviceId: null, alertKind, severity });
  }
  if (deviceKind && alertKind) {
    orConditions.push({ deviceKind, deviceId: null, alertKind, severity: null });
  }
  if (deviceKind) {
    orConditions.push({ deviceKind, deviceId: null, alertKind: null, severity: null });
  }
  if (alertKind && severity) {
    orConditions.push({ deviceKind: null, deviceId: null, alertKind, severity });
  }

   
  const runbookWhere: any = orConditions.length > 0
    ? { tenantId: user.tenantId, OR: orConditions }
    : { tenantId: user.tenantId };

  const runbooks = await prisma.runbook.findMany({
    where: runbookWhere,
    orderBy: [
      { deviceId: 'desc' },
      { severity: 'desc' },
      { useCount: 'desc' },
    ],
    take: 5,
  });

  // Pull confirmed incident history as derived runbook content
   
  const confirmedWhere: any = deviceKind ? { tenantId: user.tenantId, deviceKind } : { tenantId: user.tenantId };

  const relatedConfirmed = await prisma.confirmedIncident.findMany({
    where: confirmedWhere,
    orderBy: { observedAt: 'desc' },
    take: 3,
    select: {
      id: true, deviceKind: true, deviceId: true, severity: true,
      summary: true, rootCause: true, fix: true, observedAt: true,
    },
  });

  return NextResponse.json({
    runbooks: runbooks.map(r => ({
      id: r.id, title: r.title, content: r.content,
      deviceKind: r.deviceKind, deviceId: r.deviceId,
      alertKind: r.alertKind, severity: r.severity,
      tags: r.tags, stepCount: r.stepCount,
      useCount: r.useCount, lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
    })),
    relatedHistory: relatedConfirmed.map(c => ({
      id: c.id, deviceKind: c.deviceKind, deviceId: c.deviceId,
      severity: c.severity, summary: c.summary.slice(0, 200),
      rootCause: c.rootCause, fix: c.fix,
      observedAt: c.observedAt.toISOString(),
    })),
  });
}

/**
 * POST /api/ops/runbooks — record that a runbook was used
 * Body: { id: string }
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!hasPermission(user.role, 'view_network')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body?.id) return NextResponse.json({ error: 'Missing runbook id' }, { status: 400 });

  await prisma.runbook.updateMany({
    where: { id: body.id, tenantId: user.tenantId },
    data: { lastUsedAt: new Date(), useCount: { increment: 1 } },
  });

  return NextResponse.json({ ok: true });
}
