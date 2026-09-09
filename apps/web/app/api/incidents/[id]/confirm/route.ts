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
  // Optional link to the technician's feedback that motivated this
  // promotion. Cognitive-investigation (Fase 1): a `confirmed` feedback
  // is NOT required to promote. The application validates
  // (tenantId, investigationFeedbackId) before persisting so a foreign
  // or nonexistent feedback cannot slip into the immutable KB.
  investigationFeedbackId: z.string().min(1).max(128).optional(),
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

  // Cognitive-investigation (Fase 1): if the operator opted to link a
  // feedback, the (tenantId, feedbackId) MUST resolve in this tenant.
  // We refuse foreign / nonexistent feedback to keep the immutable KB
  // free of orphan references. Negative feedback (`incorrect` /
  // `insufficient_data`) is REJECTED here: a negative adjudication MUST
  // NOT promote an incident — the operator must re-run a fresh confirm
  // without the link, or change the feedback label first.
  let linkedFeedbackId: string | null = null;
  if (parsed.data.investigationFeedbackId) {
    const feedback = await prisma.investigationFeedback.findFirst({
      where: {
        tenantId: user.tenantId,
        feedbackId: parsed.data.investigationFeedbackId,
      },
      select: { feedbackId: true, label: true },
    });
    if (!feedback) {
      return NextResponse.json(
        { error: 'investigationFeedbackId not found in this tenant' },
        { status: 404 },
      );
    }
    if (feedback.label !== 'confirmed') {
      return NextResponse.json(
        {
          error:
            'Only a `confirmed` feedback may be linked to a ConfirmedIncident. ' +
            'Negative adjudications MUST NOT promote an incident.',
          feedbackLabel: feedback.label,
        },
        { status: 409 },
      );
    }
    linkedFeedbackId = feedback.feedbackId;
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
      investigationFeedbackId: linkedFeedbackId,
      sourceTool: linkedFeedbackId ? '__investigation_confirm__' : '__operator_confirm__',
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
      toolName: linkedFeedbackId ? '__investigation_confirm__' : '__operator_confirm__',
      parameters: (
        linkedFeedbackId
          ? { ...parsed.data, investigationFeedbackId: linkedFeedbackId }
          : { rootCause: parsed.data.rootCause, fix: parsed.data.fix, summary: parsed.data.summary }
      ) as unknown as object,
      result: created.id,
      durationMs: 0,
    },
  });

  return NextResponse.json(created, { status: 201 });
}