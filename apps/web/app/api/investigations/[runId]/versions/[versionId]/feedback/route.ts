import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma, prisma } from '@ftth-copilot/db';
import { getCurrentUser } from '@/lib/auth/server';
import { hasPermission } from '@/lib/auth/permissions';
import {
  buildIdempotencyKey,
  clampFreeText,
  FEEDBACK_LABELS,
  generateFeedbackId,
  isFeedbackLabel,
} from '@/lib/investigations/feedback';

/**
 * POST /api/investigations/:runId/versions/:versionId/feedback — record
 * one technician adjudication of one diagnostic version.
 *
 * Idempotency: the row's @@unique constraint is
 *   (tenantId, runId, versionId, authorUserId, label)
 * which is also the helper `buildIdempotencyKey` output. A second POST
 * with the same body returns the existing row verbatim with status 200;
 * the client sees the same feedbackId and `idempotent: true`.
 *
 * Tenant scoping: every lookup is filtered by `user.tenantId`. The
 * client cannot supply tenantId, runId must match a row owned by the
 * caller's tenant, and versionId must belong to that run. Cross-tenant
 * requests return 404, never 403, to avoid leaking the existence of
 * foreign runs.
 *
 * Audit: a successful write logs an `AgentActionLog` entry with
 *   toolName: '__investigation_feedback__'
 * so audit reconstruction works even when the feedback row is later
 * orphaned (e.g. version deleted under SetNull).
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  label: z.string().refine(isFeedbackLabel, {
    message: `label must be one of: ${FEEDBACK_LABELS.join(', ')}`,
  }),
  observations: z.string().max(8 * 1024).optional(),
  realCause: z.string().max(8 * 1024).optional(),
  resolutionEvidence: z.string().max(8 * 1024).optional(),
  feedbackId: z.string().optional(),
});

export async function POST(
  req: Request,
  ctx: { params: Promise<{ runId: string; versionId: string }> },
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
  const { runId, versionId } = await ctx.params;
  const { label, feedbackId: clientFeedbackId } = parsed.data;

  // Authoritative tenant scope: every read is filtered by `user.tenantId`.
  const run = await prisma.investigationRun.findFirst({
    where: { tenantId: user.tenantId, runId },
    select: { id: true, runId: true },
  });
  if (!run) {
    return NextResponse.json({ error: 'Investigation run not found' }, { status: 404 });
  }

  const version = await prisma.investigationVersion.findFirst({
    where: {
      tenantId: user.tenantId,
      runId,
      versionId,
    },
    select: { id: true, versionId: true, runRefId: true },
  });
  if (!version) {
    return NextResponse.json(
      { error: 'Investigation version not found for this run' },
      { status: 404 },
    );
  }

  // Idempotency: look for an existing row with the same fingerprint. We
  // MUST return it as 200 with `idempotent: true` so the client can
  // distinguish a fresh insert from a retry.
  const existing = await prisma.investigationFeedback.findFirst({
    where: {
      tenantId: user.tenantId,
      runId,
      versionId,
      authorUserId: user.id,
      label,
    },
  });
  if (existing) {
    return NextResponse.json(
      {
        feedbackId: existing.feedbackId,
        runId: existing.runId,
        versionId: existing.versionId,
        label: existing.label,
        observations: existing.observations,
        realCause: existing.realCause,
        resolutionEvidence: existing.resolutionEvidence,
        authorUserId: existing.authorUserId,
        submittedAt: existing.submittedAt.toISOString(),
        idempotent: true,
        idempotencyKey: buildIdempotencyKey(
          user.tenantId,
          runId,
          versionId,
          user.id,
          label,
        ),
      },
      { status: 200 },
    );
  }

  const feedbackId = clientFeedbackId ?? generateFeedbackId();
  const observations = clampFreeText(parsed.data.observations ?? null);
  const realCause = clampFreeText(parsed.data.realCause ?? null);
  const resolutionEvidence = clampFreeText(parsed.data.resolutionEvidence ?? null);

  try {
    const created = await prisma.investigationFeedback.create({
      data: {
        tenantId: user.tenantId,
        runRefId: run.id,
        versionRefId: version.id,
        runId,
        versionId,
        feedbackId,
        label,
        observations,
        realCause,
        resolutionEvidence,
        authorUserId: user.id,
      },
      select: {
        feedbackId: true,
        runId: true,
        versionId: true,
        label: true,
        observations: true,
        realCause: true,
        resolutionEvidence: true,
        authorUserId: true,
        submittedAt: true,
      },
    });

    await prisma.agentActionLog.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        toolName: '__investigation_feedback__',
        parameters: {
          runId,
          versionId,
          feedbackId: created.feedbackId,
          label,
        } as unknown as object,
        result: created.feedbackId,
        durationMs: 0,
      },
    });

    return NextResponse.json(
      {
        feedbackId: created.feedbackId,
        runId: created.runId,
        versionId: created.versionId,
        label: created.label,
        observations: created.observations,
        realCause: created.realCause,
        resolutionEvidence: created.resolutionEvidence,
        authorUserId: created.authorUserId,
        submittedAt: created.submittedAt.toISOString(),
        idempotent: false,
        idempotencyKey: buildIdempotencyKey(
          user.tenantId,
          runId,
          versionId,
          user.id,
          label,
        ),
      },
      { status: 201 },
    );
  } catch (err) {
    // The @@unique constraint is the second-line defense: if two parallel
    // requests both pass the duplicate check above, the DB still collapses
    // them. We translate P2002 to the same idempotent response.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      const recovered = await prisma.investigationFeedback.findFirst({
        where: {
          tenantId: user.tenantId,
          runId,
          versionId,
          authorUserId: user.id,
          label,
        },
      });
      if (recovered) {
        return NextResponse.json(
          {
            feedbackId: recovered.feedbackId,
            runId: recovered.runId,
            versionId: recovered.versionId,
            label: recovered.label,
            observations: recovered.observations,
            realCause: recovered.realCause,
            resolutionEvidence: recovered.resolutionEvidence,
            authorUserId: recovered.authorUserId,
            submittedAt: recovered.submittedAt.toISOString(),
            idempotent: true,
            idempotencyKey: buildIdempotencyKey(
              user.tenantId,
              runId,
              versionId,
              user.id,
              label,
            ),
          },
          { status: 200 },
        );
      }
    }
    throw err;
  }
}
