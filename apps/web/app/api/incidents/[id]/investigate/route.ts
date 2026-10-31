import { NextResponse, after } from 'next/server';
import { prisma, getLatestInvestigationVersion } from '@ftth-copilot/db';
import { workerOwnsBackgroundWork } from '@ftth-copilot/jobs';
import type { InvestigationResult } from '@ftth-copilot/shared';
import { getCurrentUser } from '@/lib/auth/server';
import { hasPermission } from '@/lib/auth/permissions';
import { consumeInvestigationQuota } from '@/lib/investigations/quota';
import {
  awaitAttemptOutcome,
  claimInvestigationAttempt,
  completeInvestigation,
  failInvestigation,
  runInvestigationPipeline,
} from '@/lib/investigations/pipeline';
import { enqueueInvestigationAttempt } from '@/lib/investigations/dispatch';

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
    orderBy: { createdAt: 'asc' },
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
 *
 * The pipeline runs exactly once per attempt (S20):
 *  - `claimInvestigationAttempt` decides under a per-incident lock whether
 *    this request owns a new attempt, so simultaneous requests never start
 *    two;
 *  - in `worker` mode the route only enqueues the attempt and waits for its
 *    result up to the HTTP budget (201 if it finished, 202 if not);
 *  - in `embedded` mode the route runs the pipeline and attaches the closure
 *    to THAT promise: past the budget it answers 202 and the same promise
 *    still stores the result (or leaves the run `failed`) when it settles.
 *    It never starts the pipeline a second time.
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

  // 3. Claim the attempt (atomic per incident)
  const claim = await claimInvestigationAttempt({
    tenantId: user.tenantId,
    incidentId: incident.id,
    connectionId: incident.connectionId ?? null,
    userId: user.id,
    refresh: isRefresh,
  });

  if (claim.kind === 'pending') {
    return NextResponse.json(
      {
        runId: claim.runId,
        status: 'pending',
        retryAfterMs: 3000,
        message: 'Investigation is currently processing',
      },
      { status: 202 },
    );
  }

  if (claim.kind === 'ready') {
    const latest = await getLatestInvestigationVersion({
      tenantId: user.tenantId,
      runId: claim.runId,
    });
    return NextResponse.json(
      {
        runId: claim.runId,
        versionId: latest?.versionId ?? null,
        versionIndex: latest?.versionIndex ?? 0,
        status: 'ready',
        idempotent: true,
        result: latest?.snapshot ?? null,
      },
      { status: 200 },
    );
  }

  const { runId, versionId } = claim;
  const attempt = {
    tenantId: user.tenantId,
    incidentId: incident.id,
    runId,
    versionId,
    userId: user.id,
    windowDays: body.windowDays,
    startedAtMs: claim.attemptStartedAt.getTime(),
  };
  const pendingResponse = () =>
    NextResponse.json(
      {
        runId,
        versionId,
        status: 'pending',
        retryAfterMs: 3000,
        message: 'Investigation execution pending: maximum HTTP wait exceeded',
      },
      { status: 202 },
    );
  const readyResponse = (version: { versionId: string; versionIndex: number }, result: unknown) =>
    NextResponse.json(
      {
        runId,
        versionId: version.versionId,
        versionIndex: version.versionIndex,
        status: 'ready',
        idempotent: false,
        result,
      },
      { status: 201 },
    );
  const failedResponse = () =>
    NextResponse.json(
      { runId, versionId, status: 'failed', error: 'Investigation failed' },
      { status: 500 },
    );

  // 4a. Worker mode: enqueue, then wait for the worker up to the budget.
  if (workerOwnsBackgroundWork()) {
    try {
      await enqueueInvestigationAttempt(attempt);
    } catch (err) {
      // Without the job nobody would ever close this attempt: fail it now so
      // the incident can be investigated again, and tell the caller.
      const reason = `could not enqueue the investigation: ${err instanceof Error ? err.message : String(err)}`;
      await failInvestigation({ ...attempt, reason }).catch((closeErr: unknown) => {
        console.error('[investigate] could not fail an unqueued attempt', closeErr);
      });
      return NextResponse.json(
        { runId, versionId, status: 'failed', error: 'Investigation queue unavailable' },
        { status: 503 },
      );
    }

    const outcome = await awaitAttemptOutcome({
      tenantId: user.tenantId,
      runId,
      versionId,
      timeoutMs,
    });
    if (outcome.kind === 'ready') return readyResponse(outcome.version, outcome.version.snapshot);
    if (outcome.kind === 'failed') return failedResponse();
    return pendingResponse();
  }

  // 4b. Embedded mode: run here, and close THIS promise whatever its timing.
  type Closed =
    | { kind: 'ready'; version: { versionId: string; versionIndex: number }; result: InvestigationResult }
    | { kind: 'failed' };

  const closing: Promise<Closed> = runInvestigationPipeline({
    tenantId: user.tenantId,
    incidentId: incident.id,
    runId,
    versionId,
    deviceId: incident.deviceId,
    deviceKind: incident.deviceKind,
    connectionId: incident.connectionId ?? null,
    windowDays: body.windowDays,
  })
    .then(async (result): Promise<Closed> => {
      const version = await completeInvestigation({ ...attempt, investigationResult: result });
      return { kind: 'ready', version, result };
    })
    .catch(async (err: unknown): Promise<Closed> => {
      const reason = err instanceof Error ? err.message : String(err);
      await failInvestigation({ ...attempt, reason }).catch((closeErr: unknown) => {
        console.error('[investigate] could not record a failed attempt', closeErr);
      });
      return { kind: 'failed' };
    });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
  });
  const outcome = await Promise.race([closing, timeout]);
  if (timer) clearTimeout(timer);

  if (outcome === 'timeout') {
    // The same promise keeps running and closes the attempt when it settles.
    // `after` tells Next to keep the request's work alive past the response.
    try {
      after(() => closing);
    } catch {
      // Outside a request scope (unit tests): the promise runs on its own.
    }
    return pendingResponse();
  }
  if (outcome.kind === 'failed') return failedResponse();
  return readyResponse(outcome.version, outcome.result);
}
