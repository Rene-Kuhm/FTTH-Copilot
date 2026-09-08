import { NextResponse } from 'next/server';
import { prisma } from '@ftth-copilot/db';
import { getCurrentUser } from '@/lib/auth/server';
import { hasPermission } from '@/lib/auth/permissions';

/**
 * GET /api/investigations/:runId/feedbacks — list feedback rows for a run.
 *
 * The route is scoped to the caller's tenant: a query for tenant A's
 * runId from tenant B MUST return 404 (the unique lookup key is
 * `tenantId_runId`). No client-supplied tenantId is honored.
 *
 * The result is ordered by `submittedAt` ascending so a UI can render a
 * timeline without further sorting. Pagination is bounded by `limit`
 * (default 50, max 200) to keep the response size predictable.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

export async function GET(
  req: Request,
  ctx: { params: Promise<{ runId: string }> },
): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!hasPermission(user.role, 'view_network')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const { runId } = await ctx.params;

  const url = new URL(req.url);
  const limitParam = url.searchParams.get('limit');
  let limit = DEFAULT_LIMIT;
  if (limitParam) {
    const parsed = Number.parseInt(limitParam, 10);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > MAX_LIMIT) {
      return NextResponse.json(
        { error: 'limit must be an integer between 1 and 200' },
        { status: 400 },
      );
    }
    limit = parsed;
  }

  // Confirm the run exists in this tenant. Without this guard a foreign
  // runId would silently return an empty list, which is a cross-tenant
  // signal we MUST avoid leaking.
  const run = await prisma.investigationRun.findFirst({
    where: { tenantId: user.tenantId, runId },
    select: { runId: true, status: true, requestedAt: true },
  });
  if (!run) {
    return NextResponse.json({ error: 'Investigation run not found' }, { status: 404 });
  }

  const rows = await prisma.investigationFeedback.findMany({
    where: { tenantId: user.tenantId, runId },
    orderBy: [{ submittedAt: 'asc' }, { feedbackId: 'asc' }],
    take: limit,
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

  return NextResponse.json({
    runId,
    status: run.status,
    requestedAt: run.requestedAt.toISOString(),
    feedbacks: rows.map((r) => ({
      feedbackId: r.feedbackId,
      runId: r.runId,
      versionId: r.versionId,
      label: r.label,
      observations: r.observations,
      realCause: r.realCause,
      resolutionEvidence: r.resolutionEvidence,
      authorUserId: r.authorUserId,
      submittedAt: r.submittedAt.toISOString(),
    })),
    count: rows.length,
    limit,
  });
}
