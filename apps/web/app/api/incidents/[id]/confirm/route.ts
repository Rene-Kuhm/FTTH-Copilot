import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@ftth-copilot/db';
import { getCurrentUser } from '@/lib/auth/server';
import { hasPermission } from '@/lib/auth/permissions';
import { tokenize } from '@ftth-copilot/evidence';

/**
 * POST /api/incidents/:id/confirm — operator confirmation path for Fase D.
 *
 * Validates the body, enforces `view_network`, refuses on a missing or
 * still-open incident, and writes exactly one `ConfirmedIncident` +
 * one `AgentActionLog` (`toolName: '__operator_confirm__'`).
 * Idempotent: a second POST for the same `sourceIncidentId` returns
 * the existing row with zero new writes.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  rootCause: z.string().min(1),
  fix: z.string().min(1),
  summary: z.string().min(1),
});

function buildSearchTokens(rootCause: string, fix: string, summary: string): string {
  // Lowercased, deduped, sorted, stop-word-trimmed — `tokenize` already
  // produces a deterministic token stream; we dedup via Set to match the
  // design's "dedup + sort" contract for the persisted column.
  const tokens = tokenize(`${rootCause} ${fix} ${summary}`);
  return Array.from(new Set(tokens)).sort().join(' ');
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!hasPermission(user.role, 'view_network')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { id } = await ctx.params;

  const incident = await prisma.incident.findFirst({
    where: { id, tenantId: user.tenantId },
    select: { id: true, tenantId: true, deviceKind: true, deviceId: true, status: true, firstSeenAt: true, resolvedAt: true },
  });
  if (!incident) {
    return NextResponse.json({ error: 'Incident not found' }, { status: 404 });
  }
  if (incident.status !== 'resolved') {
    return NextResponse.json(
      { error: 'Solo se pueden confirmar incidentes resueltos.' },
      { status: 409 },
    );
  }

  // Idempotency: an existing ConfirmedIncident for this source incident is
  // returned verbatim with no DB writes — re-confirming is a no-op.
  const existing = await prisma.confirmedIncident.findFirst({
    where: { tenantId: user.tenantId, sourceIncidentId: id },
  });
  if (existing) {
    return NextResponse.json(existing, { status: 200 });
  }

  const now = new Date();
  const searchTokens = buildSearchTokens(parsed.data.rootCause, parsed.data.fix, parsed.data.summary);

  const created = await prisma.confirmedIncident.create({
    data: {
      tenantId: user.tenantId,
      deviceKind: incident.deviceKind,
      deviceId: incident.deviceId,
      sourceIncidentId: incident.id,
      sourceTool: '__operator_confirm__',
      summary: parsed.data.summary,
      symptoms: {} as object,
      rootCause: parsed.data.rootCause,
      fix: parsed.data.fix,
      observedAt: incident.firstSeenAt,
      resolvedAt: incident.resolvedAt ?? now,
      confirmedBy: 'operator',
      confirmedByUserId: user.id,
      searchTokens,
    },
  });

  await prisma.agentActionLog.create({
    data: {
      tenantId: user.tenantId,
      userId: user.id,
      toolName: '__operator_confirm__',
      parameters: parsed.data as unknown as object,
      result: created.id,
      durationMs: 0,
    },
  });

  return NextResponse.json(created, { status: 201 });
}