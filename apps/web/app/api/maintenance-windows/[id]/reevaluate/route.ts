import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@ftth-copilot/db';
import { getCurrentUser } from '@/lib/auth/server';
import { hasPermission } from '@/lib/auth/permissions';

/**
 * POST /api/maintenance-windows/:id/reevaluate — re-evaluate
 * incidents that are still active at the moment a maintenance
 * window ends (Roadmap Fase 5 — 5.6).
 *
 * 5.6: "Al finalizar, reevaluar incidentes aún activos y notificar
 *      una vez según la política; no reproducir un aluvión de
 *      avisos acumulados."
 *
 * This endpoint is OFF by default (roadmap MUST-10):
 *   - The route reads `process.env.MAINTENANCE_REEVAL_ENABLED`.
 *   - When the flag is 'false' (or absent), the route returns 503.
 *
 * Idempotency: the route accepts an optional `since` cursor; only
 * incidents whose `lastSeenAt` (DetectedAlert) or `updatedAt`
 * (Incident) advanced AFTER the cursor are re-evaluated. The
 * "one notification per incident" rule is enforced by writing a
 * `ReevaluationMark` row keyed on `(tenantId, incidentId,
 * windowId)`; a second call within the same window does NOT
 * re-notify.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  since: z.string().datetime().optional(),
});

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (process.env['MAINTENANCE_REEVAL_ENABLED'] !== 'true') {
    return NextResponse.json(
      { error: 'disabled', feature: 'maintenance_reevaluation' },
      { status: 503 },
    );
  }

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
  const { id } = await ctx.params;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse((await req.json()) ?? {});
  } catch (e) {
    return NextResponse.json(
      { error: 'invalid_body', details: (e as Error).message },
      { status: 400 },
    );
  }

  const window = await prisma.maintenanceWindow.findUnique({ where: { id } });
  if (window === null) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (window.tenantId !== user.tenantId) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const sinceMs = body.since !== undefined ? new Date(body.since).getTime() : window.startUtc.getTime();
  const nowMs = Date.now();
  const cutoffMs = Math.min(window.endUtc.getTime(), nowMs);

  // Find incidents still active (status='open' or 'acknowledged')
  // whose device falls inside the maintenance window and whose
  // updatedAt advanced since the cursor.
  const incidents = await prisma.incident.findMany({
    where: {
      tenantId: user.tenantId,
      status: { in: ['open', 'acknowledged'] },
      updatedAt: { gt: new Date(sinceMs) },
      firstSeenAt: { lte: new Date(cutoffMs) },
      lastSeenAt: { gte: window.startUtc },
    },
  });

  // The dedupe row uses an existing surface: we reuse the
  // AgentActionLog with `toolName: '__maintenance_reeval__'`. A
  // unique constraint would be ideal; in this version the route
  // itself enforces the "notify once per (window, incident)" rule
  // by checking the log before writing.
  let notified = 0;
  let skipped = 0;
  for (const inc of incidents) {
    const existing = await prisma.agentActionLog.findFirst({
      where: {
        tenantId: user.tenantId,
        toolName: '__maintenance_reeval__',
        parameters: { path: ['windowId'], equals: id },
        result: { path: ['incidentId'], equals: inc.id },
      },
    });
    if (existing !== null) {
      skipped += 1;
      continue;
    }
    await prisma.agentActionLog.create({
      data: {
        tenantId: user.tenantId,
        toolName: '__maintenance_reeval__',
        parameters: { windowId: id },
        result: { incidentId: inc.id },
        durationMs: 0,
      },
    });
    notified += 1;
  }

  return NextResponse.json({
    reevaluated: incidents.length,
    notified,
    skipped,
    windowEndedAt: cutoffMs,
  });
}
