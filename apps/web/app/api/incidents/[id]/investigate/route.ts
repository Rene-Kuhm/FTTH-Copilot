import { NextResponse } from 'next/server';
import { Prisma, prisma, getLatestInvestigationVersion, persistInvestigationVersion } from '@ftth-copilot/db';
import { getCurrentUser } from '@/lib/auth/server';
import { hasPermission } from '@/lib/auth/permissions';
import { generateFeedbackId } from '@/lib/investigations/feedback';
import { consumeInvestigationQuota } from '@/lib/investigations/quota';
import { runInvestigationPipeline } from '@/lib/investigations/pipeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_TIMEOUT_MS = 8000;

interface RequestBody {
  refresh?: boolean;
  timeoutMs?: number;
  windowDays?: number;
}

/**
 * GET /api/incidents/:id/investigate — retrieves the current investigation run
 * and latest immutable version snapshot for an incident.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!hasPermission(user.role, 'view_network')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const { id } = await ctx.params;

  const incident = await prisma.incident.findFirst({
    where: { id, tenantId: user.tenantId },
    select: { id: true },
  });
  if (!incident) {
    return NextResponse.json({ error: 'Incident not found' }, { status: 404 });
  }

  const run = await prisma.investigationRun.findFirst({
    where: { tenantId: user.tenantId, incidentId: incident.id },
    select: { id: true, runId: true, status: true, requestedAt: true },
  });
  if (!run) {
    return NextResponse.json({ error: 'Investigation run not found' }, { status: 404 });
  }

  const latestVersion = await getLatestInvestigationVersion({
    tenantId: user.tenantId,
    runId: run.runId,
  });

  return NextResponse.json(
    {
      runId: run.runId,
      status: run.status,
      requestedAt: run.requestedAt.toISOString(),
      version: latestVersion
        ? {
            versionId: latestVersion.versionId,
            versionIndex: latestVersion.versionIndex,
            rulesetVersion: latestVersion.rulesetVersion,
            modelVersion: latestVersion.modelVersion,
            snapshotAt: latestVersion.snapshotAt.toISOString(),
            snapshot: latestVersion.snapshot,
          }
        : null,
    },
    { status: 200 },
  );
}

/**
 * POST /api/incidents/:id/investigate — initiates or refreshes a cognitive investigation run.
 * Enforces quotas, bounds execution time, protects against concurrent duplicates,
 * and persists immutable version snapshots.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!hasPermission(user.role, 'view_network')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  // 1. Quota & rate limit check
  const quota = await consumeInvestigationQuota(user.id);
  if (!quota.allowed) {
    return NextResponse.json(
      { error: 'Investigation quota exceeded', retryAfter: quota.retryAfter },
      { status: 429, headers: { 'Retry-After': String(quota.retryAfter) } },
    );
  }

  const { id } = await ctx.params;

  // 2. Incident lookup within caller tenant
  const incident = await prisma.incident.findFirst({
    where: { id, tenantId: user.tenantId },
    select: { id: true, deviceKind: true, deviceId: true, connectionId: true },
  });
  if (!incident) {
    return NextResponse.json({ error: 'Incident not found' }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as RequestBody;
  const isRefresh = Boolean(body.refresh);
  const timeoutMs = Math.min(body.timeoutMs ?? DEFAULT_TIMEOUT_MS, 15000);

  // 3. Existing run check & duplicate protection
  const existingRun = await prisma.investigationRun.findFirst({
    where: { tenantId: user.tenantId, incidentId: incident.id },
    select: { id: true, runId: true, status: true },
  });

  if (existingRun) {
    // If run is currently in-flight, protect against duplicate executions
    if (existingRun.status === 'pending') {
      return NextResponse.json(
        {
          runId: existingRun.runId,
          status: 'pending',
          retryAfterMs: 3000,
          message: 'Investigation is currently processing',
        },
        { status: 202 },
      );
    }

    // If run is ready and refresh is not requested, return idempotently
    if (existingRun.status === 'ready' && !isRefresh) {
      const latest = await getLatestInvestigationVersion({
        tenantId: user.tenantId,
        runId: existingRun.runId,
      });
      return NextResponse.json(
        {
          runId: existingRun.runId,
          versionId: latest?.versionId ?? null,
          versionIndex: latest?.versionIndex ?? 0,
          status: existingRun.status,
          idempotent: true,
          result: latest?.snapshot ?? null,
        },
        { status: 200 },
      );
    }
  }

  // 4. Setup runId & versionId
  const runId = existingRun ? existingRun.runId : `r_${generateFeedbackId().slice(2)}`;
  const versionId = `v_${generateFeedbackId().slice(2)}`;

  // Ensure run row exists with status = 'pending'
  if (!existingRun) {
    await prisma.investigationRun.create({
      data: {
        tenantId: user.tenantId,
        connectionId: incident.connectionId ?? null,
        incidentId: incident.id,
        requestedByUserId: user.id,
        runId,
        status: 'pending',
      },
    });
  } else {
    await prisma.investigationRun.update({
      where: { id: existingRun.id },
      data: { status: 'pending' },
    });
  }

  // 5. Execute pipeline bounded by timeout
  const startTime = Date.now();

  try {
    const pipelinePromise = runInvestigationPipeline({
      tenantId: user.tenantId,
      incidentId: incident.id,
      runId,
      versionId,
      deviceId: incident.deviceId,
      deviceKind: incident.deviceKind,
      connectionId: incident.connectionId ?? null,
      windowDays: body.windowDays,
    });

    let timer: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), timeoutMs);
    });

    const outcome = await Promise.race([pipelinePromise, timeoutPromise]);
    if (timer) clearTimeout(timer);

    if (outcome === 'timeout') {
      // Execution budget exceeded: return 202 Accepted pending response
      return NextResponse.json(
        {
          runId,
          versionId,
          status: 'pending',
          retryAfterMs: 3000,
          message: 'Investigation execution pending: maximum HTTP wait exceeded',
        },
        { status: 202 },
      );
    }

    // 6. Persist immutable version snapshot
    const persisted = await persistInvestigationVersion({
      tenantId: user.tenantId,
      runId,
      investigationResult: outcome,
      requestedByUserId: user.id,
    });

    await prisma.agentActionLog.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        toolName: '__investigation_open__',
        parameters: {
          incidentId: incident.id,
          runId,
          versionId: persisted.versionId,
        } as unknown as object,
        result: runId,
        durationMs: Date.now() - startTime,
      },
    });

    return NextResponse.json(
      {
        runId,
        versionId: persisted.versionId,
        versionIndex: persisted.versionIndex,
        status: 'ready',
        idempotent: false,
        result: persisted.snapshot,
      },
      { status: 201 },
    );
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      // Race: parallel creation collapsed by unique constraints
      const latest = await getLatestInvestigationVersion({
        tenantId: user.tenantId,
        runId,
      });
      return NextResponse.json(
        {
          runId,
          versionId: latest?.versionId ?? null,
          versionIndex: latest?.versionIndex ?? 0,
          status: 'ready',
          idempotent: true,
          result: latest?.snapshot ?? null,
        },
        { status: 200 },
      );
    }
    throw err;
  }
}
