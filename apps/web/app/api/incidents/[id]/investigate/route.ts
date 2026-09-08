import { NextResponse } from 'next/server';
import { Prisma, prisma } from '@ftth-copilot/db';
import { getCurrentUser } from '@/lib/auth/server';
import { hasPermission } from '@/lib/auth/permissions';
import { generateFeedbackId } from '@/lib/investigations/feedback';

/**
 * POST /api/incidents/:id/investigate — open one cognitive-investigation
 * run for an incident.
 *
 * Fase 1 placeholder: this endpoint creates an InvestigationRun with a
 * single empty InvestigationVersion (versionIndex = 0). The version's
 * snapshot is empty ({}) until Fase 3 starts producing real evidence.
 * Fase 3 will replace this endpoint with a real evidence-collection
 * pipeline; the contract is documented in
 * `docs/roadmap-investigacion-cognitiva.md` section 8.
 *
 * Idempotency: a second POST for the same incident returns the existing
 * run (and version). The technician can record feedback on the same
 * version without creating a duplicate investigation.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!hasPermission(user.role, 'view_network')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const { id } = await ctx.params;

  // Tenant-scoped lookup. A foreign incident id MUST return 404 (not
  // 403) so the route does not leak cross-tenant existence.
  const incident = await prisma.incident.findFirst({
    where: { id, tenantId: user.tenantId },
    select: { id: true, deviceKind: true, deviceId: true, connectionId: true },
  });
  if (!incident) {
    return NextResponse.json({ error: 'Incident not found' }, { status: 404 });
  }

  // Idempotent run lookup by (tenantId, incidentId). Without an index on
  // incidentId alone, the @@index([tenantId, incidentId]) we added in
  // PR #111 makes this O(log N).
  const existingRun = await prisma.investigationRun.findFirst({
    where: { tenantId: user.tenantId, incidentId: incident.id },
    select: { runId: true, status: true, createdAt: true },
  });
  if (existingRun) {
    const existingVersion = await prisma.investigationVersion.findFirst({
      where: { tenantId: user.tenantId, runId: existingRun.runId },
      orderBy: { versionIndex: 'asc' },
      select: { versionId: true, versionIndex: true },
    });
    return NextResponse.json(
      {
        runId: existingRun.runId,
        versionId: existingVersion?.versionId ?? null,
        status: existingRun.status,
        idempotent: true,
      },
      { status: 200 },
    );
  }

  // The runId / versionId are opaque app-supplied strings per Fase 0
  // contracts. `generateFeedbackId` produces a UUID-shaped id; we wrap
  // the same primitive for `r_*` and `v_*` here.
  const runId = `r_${generateFeedbackId().slice(2)}`;
  const versionId = `v_${generateFeedbackId().slice(2)}`;

  try {
    const created = await prisma.investigationRun.create({
      data: {
        tenantId: user.tenantId,
        connectionId: incident.connectionId ?? null,
        incidentId: incident.id,
        requestedByUserId: user.id,
        runId,
        status: 'pending',
      },
      select: { runId: true, status: true, createdAt: true },
    });

    await prisma.investigationVersion.create({
      data: {
        tenantId: user.tenantId,
        runId,
        versionId,
        versionIndex: 0,
        rulesetVersion: 'phase-1-placeholder',
        promptVersion: 'n/a',
        modelVersion: 'n/a',
        snapshotJson: { incident: { deviceKind: incident.deviceKind, deviceId: incident.deviceId } },
      },
      select: { versionId: true },
    });

    await prisma.agentActionLog.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        toolName: '__investigation_open__',
        parameters: {
          incidentId: incident.id,
          runId,
          versionId,
        } as unknown as object,
        result: runId,
        durationMs: 0,
      },
    });

    return NextResponse.json(
      { runId, versionId, status: created.status, idempotent: false },
      { status: 201 },
    );
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      // Race: a parallel POST created the run. Re-read and return 200.
      const r = await prisma.investigationRun.findFirst({
        where: { tenantId: user.tenantId, incidentId: incident.id },
        select: { runId: true, status: true },
      });
      if (r) {
        const v = await prisma.investigationVersion.findFirst({
          where: { tenantId: user.tenantId, runId: r.runId },
          orderBy: { versionIndex: 'asc' },
          select: { versionId: true },
        });
        return NextResponse.json(
          { runId: r.runId, versionId: v?.versionId ?? null, status: r.status, idempotent: true },
          { status: 200 },
        );
      }
    }
    throw err;
  }
}
