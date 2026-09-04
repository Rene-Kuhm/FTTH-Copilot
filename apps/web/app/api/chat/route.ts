import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { runAgent, type TruthGateMode } from '@ftth-copilot/agent-core';
import type { Abstention, ConfirmedIncident, TenantPolicy } from '@ftth-copilot/shared';
import type { RelevantIncidentResult } from '@ftth-copilot/evidence';
import { buildVerdictLogEntries } from '@ftth-copilot/eval';
import { prisma } from '@ftth-copilot/db';
import { getCurrentUser } from '@/lib/auth/server';
import { hasPermission } from '@/lib/auth/permissions';
import {
  ConnectorResolutionError,
  resolveTenantConnector,
} from '@/lib/connectors/chat-client';
import { consumeChatQuota } from '@/lib/rate-limit';
import { logRequest } from '@/lib/logging';
import { loadTenantPolicy } from '@/lib/policies/load-tenant-policy';
import {
  buildPendingIncidentCandidate,
  retrieveRelevantIncidents,
} from '@ftth-copilot/evidence';

/** WU3 — pre-LLM recall window for confirmed-incident ranking. */
const RETRIEVAL_WINDOW_DAYS = 90;
/** WU3 — top-K for the pre-LLM context block. */
const RETRIEVAL_LIMIT = 5;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Reads the runtime TruthGate mode from `process.env.TRUTH_GATE_MODE`,
 * defaulting to `'strict'` (the Fase C production behaviour). The same
 * default is exported from `@ftth-copilot/agent-core` as
 * `DEFAULT_TRUTH_GATE_MODE`; duplicating the literal here keeps the route
 * self-contained and avoids pulling runtime internals into the import
 * graph.
 *
 * Per-deployment rollback: set `TRUTH_GATE_MODE=observe` to keep Fase B
 * behaviour without rebuilding. Validated values are forwarded verbatim;
 * anything else falls back to `'strict'` so a typo can never silently
 * disable the gate.
 */
function resolveTruthGateModeFromEnv(): TruthGateMode {
  const raw = process.env['TRUTH_GATE_MODE'];
  if (raw === 'observe' || raw === 'strict') return raw;
  return 'strict';
}

const bodySchema = z.object({
  message: z.string().trim().min(1).max(8000),
  conversationId: z.string().min(1).optional(),
  connectionId: z.string().min(1).optional(),
});

type HistoryMessage = { role: 'user' | 'assistant'; content: string };

function connectorErrorResponse(error: unknown): NextResponse | null {
  if (!(error instanceof ConnectorResolutionError)) return null;
  return NextResponse.json({ error: error.message }, { status: error.status });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const start = Date.now();
  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    logRequest('POST', '/api/chat', 400, Date.now() - start);
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const user = await getCurrentUser();
  if (!user) {
    logRequest('POST', '/api/chat', 401, Date.now() - start);
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  if (!hasPermission(user.role, 'chat')) {
    logRequest('POST', '/api/chat', 403, Date.now() - start);
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const { message, conversationId, connectionId } = parsed.data;
  let conversation: { id: string; connectionId: string | null } | null = null;
  let history: HistoryMessage[] = [];

  if (conversationId) {
    conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, tenantId: user.tenantId, userId: user.id },
      select: { id: true, connectionId: true },
    });
    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }
    if (connectionId && conversation.connectionId && connectionId !== conversation.connectionId) {
      return NextResponse.json(
        { error: 'No se puede cambiar el conector de una conversación existente.' },
        { status: 409 },
      );
    }

    const priorMessages = await prisma.message.findMany({
      where: { conversationId: conversation.id, role: { in: ['user', 'assistant'] } },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { role: true, content: true },
    });
    history = priorMessages
      .reverse()
      .map((item) => ({
        role: item.role as HistoryMessage['role'],
        content: item.content.slice(0, 8000),
      }));
  }

  let resolved: Awaited<ReturnType<typeof resolveTenantConnector>>;
  let tenantPolicy: TenantPolicy | null;
  try {
    // Fase E — load the per-tenant policy once per turn, parallel with
    // connector resolution. `loadTenantPolicy` never throws (returns null
    // on absent row or parse failure), so the chat stays robust against
    // DB blips. Absent row → runAgent receives `tenantPolicy: undefined`
    // → byte-identical Fase C/D behavior.
    [resolved, tenantPolicy] = await Promise.all([
      resolveTenantConnector({
        tenantId: user.tenantId,
        connectionId: conversation?.connectionId ?? connectionId,
      }),
      loadTenantPolicy(user.tenantId),
    ]);
  } catch (error) {
    const response = connectorErrorResponse(error);
    if (response) return response;
    console.error('[ftth-copilot/api/chat] connector error', error);
    return NextResponse.json({ error: 'No se pudo preparar el conector NMS.' }, { status: 500 });
  }

  const quota = await consumeChatQuota(user.id);
  if (!quota.allowed) {
    logRequest('POST', '/api/chat', 429, Date.now() - start);
    return NextResponse.json(
      { error: 'Límite de consultas alcanzado. Intentá nuevamente más tarde.' },
      { status: 429, headers: { 'retry-after': String(quota.retryAfter) } },
    );
  }

  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        title: message.slice(0, 80),
        connectionId: resolved.dataSource.connectionId,
      },
      select: { id: true, connectionId: true },
    });
  } else if (!conversation.connectionId && resolved.dataSource.connectionId) {
    conversation = await prisma.conversation.update({
      where: { id: conversation.id },
      data: { connectionId: resolved.dataSource.connectionId },
      select: { id: true, connectionId: true },
    });
  }

  await prisma.message.create({
    data: { conversationId: conversation.id, role: 'user', content: message },
  });

  /**
   * WU3 — Phase D retrieval closure. Loads the tenant-scoped candidate
   * window (last 90 days), delegates the ranking to the pure-TS
   * `retrieveRelevantIncidents`, and returns the result set. Demo mode
   * short-circuits to `[]` without touching the DB — keeping Fase C
   * behaviour identical to Fase B/C for demo connectors.
   *
   * Fase E — per-tenant knobs (retrievalLimit / retrievalSinceDays) are
   * forwarded to `retrieveRelevantIncidents` as the 2nd optional arg.
   * Resolution precedence is `args.X ?? tenantPolicy.X ?? moduleDefault.X`
   * (the per-tenant knobs only kick in when the runtime does NOT pass
   * an explicit arg, which it does for retrievalLimit / retrievalSinceDays
   * when the resolved tenant policy sets them).
   */
  const retrievalProvider = async (providerArgs: {
    tenantId: string;
    query: string;
    deviceHint?: string;
    limit?: number;
    sinceDays?: number;
    mode?: 'live' | 'demo';
  }): Promise<RelevantIncidentResult[]> => {
    if ((providerArgs.mode ?? resolved.dataSource.mode) !== 'live') return [];
    const effectiveLimit = providerArgs.limit ?? tenantPolicy?.retrievalLimit ?? RETRIEVAL_LIMIT;
    const effectiveSinceDays =
      providerArgs.sinceDays ?? tenantPolicy?.retrievalSinceDays ?? RETRIEVAL_WINDOW_DAYS;
    const cutoff = new Date(Date.now() - effectiveSinceDays * 86_400_000);
    const confirmedIncidents = (await prisma.confirmedIncident.findMany({
      where: {
        tenantId: providerArgs.tenantId,
        resolvedAt: { gte: cutoff },
      },
      select: {
        id: true,
        tenantId: true,
        deviceKind: true,
        deviceId: true,
        sourceTool: true,
        summary: true,
        rootCause: true,
        fix: true,
        symptoms: true,
        observedAt: true,
        resolvedAt: true,
        createdAt: true,
        updatedAt: true,
        confirmedBy: true,
        confirmedByUserId: true,
        searchTokens: true,
      },
    })) as unknown as ConfirmedIncident[];
    return retrieveRelevantIncidents(
      {
        tenantId: providerArgs.tenantId,
        query: providerArgs.query,
        deviceHint: providerArgs.deviceHint,
        limit: effectiveLimit,
        sinceDays: effectiveSinceDays,
        mode: 'live',
        confirmedIncidents,
      },
      tenantPolicy ?? undefined,
    );
  };

  let result;
  try {
    result = await runAgent({
      userMessage: message,
      conversationHistory: history,
      connector: resolved.connector,
      dataSource: resolved.dataSource,
      tenantId: user.tenantId,
      connectionId: resolved.dataSource.connectionId ?? undefined,
      mode: resolveTruthGateModeFromEnv(),
      // Fase E — per-tenant policy loaded parallel with connector
      // resolution above. Absent row → undefined → Fase C/D byte-identical.
      tenantPolicy: tenantPolicy ?? undefined,
      retrievalProvider,
      predictionProvider: async () =>
        prisma.detectedAlert.findMany({
          where: { tenantId: user.tenantId, status: 'open' },
          orderBy: [{ severity: 'desc' }, { lastSeenAt: 'desc' }],
          take: 50,
          select: {
            kind: true,
            severity: true,
            deviceKind: true,
            deviceId: true,
            title: true,
            description: true,
            etaMs: true,
            confidence: true,
            lastSeenAt: true,
          },
        }),
    });
  } catch (error) {
    console.error('[ftth-copilot/api/chat] agent error', error);
    logRequest('POST', '/api/chat', 502, Date.now() - start);
    return NextResponse.json(
      { error: 'El proveedor de IA no pudo completar la consulta.' },
      { status: 502 },
    );
  }

  // Fase C: persist the abstention envelope as a synthetic `__abstention__`
  // tool-call row alongside any real tool calls the agent executed. The
  // synthetic row keeps the audit trail (Message.toolCalls JSON column)
  // self-describing: clients reconstruct the bubble by reading the row,
  // not by parsing content. In observe mode (and for non-abstaining runs
  // in strict mode) result.abstained is undefined and the toolCalls array
  // is forwarded unchanged.
  const abstained = result.abstained === true;
  const abstention: Abstention | undefined = abstained ? result.abstention : undefined;
  const persistedToolCalls = abstained
    ? [
        ...result.toolCalls,
        { name: '__abstention__', arguments: {}, result: abstention },
      ]
    : result.toolCalls;

  /**
   * Fase F (F-5.2) — injection-suspicion observability row.
   *
   * When `finalize` (F-3) populates `result.warnings: VerdictCode[]`,
   * persist exactly one `AgentActionLog` row with
   * `toolName === '__injection_suspicion__'` carrying the warn codes.
   * The row is written BEFORE the per-tool-call loop so it appears
   * first in audit timelines (a deliberate ordering for the
   * `NightOperatorPanel` / audit timeline UI).
   *
   * Empty `warnings` → zero rows (the chat route does NOT write a
   * suspicious row when the LLM produced a clean allow path).
   *
   * `parameters` carries the active `mode` + the deduped distinct warn
   * codes; `result` carries the row count for the audit trail's
   * cardinality filter. `tenantId` / `userId` / `conversationId` follow
   * the existing `AgentActionLog` schema — see F-1 / design.md
   * §File Changes for the column contract.
   */
  const warnCodes = result.warnings ?? [];
  if (warnCodes.length > 0) {
    await prisma.agentActionLog.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        connectionId: resolved.dataSource.connectionId,
        conversationId: conversation.id,
        toolName: '__injection_suspicion__',
        parameters: {
          mode: resolveTruthGateModeFromEnv(),
          warnCodes,
        },
        result: { count: warnCodes.length },
        durationMs: 0,
      },
    });
  }

  const assistantMessage = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      role: 'assistant',
      content: result.text,
      toolCalls:
        persistedToolCalls.length > 0
          ? (persistedToolCalls as unknown as object)
          : undefined,
    },
  });

  for (const toolCall of persistedToolCalls) {
    await prisma.agentActionLog.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        connectionId: resolved.dataSource.connectionId,
        conversationId: conversation.id,
        toolName: toolCall.name,
        parameters: toolCall.arguments as unknown as object,
        result: (toolCall.result as unknown as object) ?? undefined,
        durationMs: 0,
      },
    });
  }

  /**
   * Fase F (F-5.2) — verdict_log persistence gate.
   *
   * Writes one `verdict_log` row per verdict in `result.verdicts`. The
   * builder (`buildVerdictLogEntries`) lives in `@ftth-copilot/eval`
   * (pure TS) so the same surface is callable from the F-6 nightly
   * metrics leg without a Prisma dependency. The DB write itself is
   * `prisma.verdictLog.createMany` — wrapped in a fail-safe try/catch
   * so a DB blip NEVER breaks the chat (verdict_log is an
   * observability side channel; the LLM text already shipped to the
   * operator on `prisma.message.create` above).
   *
   * Correlation keys follow the F-1 spec ("Correlation keys present"):
   *   - `tenantId`       — the operator's tenant
   *   - `messageId`      — the persisted assistant `Message.id` (FK +
   *                        CASCADE handles cleanup on message deletion)
   *   - `conversationId` — soft ref to the owning conversation
   *
   * Empty `verdicts` → empty entries array → `createMany` is
   * short-circuited (no wasted DB round-trip on the clean allow path).
   */
  try {
    const verdictLogEntries = buildVerdictLogEntries(result.verdicts ?? [], {
      tenantId: user.tenantId,
      messageId: assistantMessage.id,
      conversationId: conversation.id,
    });
    if (verdictLogEntries.length > 0) {
      // Narrow the optional `messageId` / `injectionSuspicion` to the
      // non-null Prisma column shape at the write boundary. The buildVerdictLogEntries
      // builder type-encodes the optional fields for the F-4 nightly
      // recompute path; here the chat route always supplies both, so
      // the cast is purely structural (no runtime widening).
      await prisma.verdictLog.createMany({
        data: verdictLogEntries.map((e) => ({
          tenantId: e.tenantId,
          messageId: e.messageId ?? assistantMessage.id,
          conversationId: e.conversationId ?? conversation.id,
          toolName: e.toolName,
          code: e.code,
          severity: e.severity,
          ...(e.observedAt !== undefined ? { observedAt: new Date(e.observedAt) } : {}),
          injectionSuspicion: e.injectionSuspicion ?? false,
        })),
      });
    }
  } catch (error) {
    // Fail-safe: log + skip, never throw. The chat response must
    // always return 200 once `prisma.message.create` has succeeded.
    console.error('[ftth-copilot/api/chat] verdict_log write failed', error);
  }

  /**
   * WU3 — Fase D PendingIncidentCandidate write gate. Admin promotion is
   * owned by `/api/pending-incidents/promote` (WU5). The chat route is the
   * drafter: one row per clean (non-abstained, no `incomplete` verdict)
   * live run, persisted as `status: 'pending'`. Demo mode AND abstained
   * runs AND any run with an `incomplete` verdict write ZERO rows — the
   * promotion helper then has nothing to skip on the admin path.
   *
   * `buildPendingIncidentCandidate` is a pure constructor (no DB), the
   * schema is locked to `ftth.pending-incident-candidate.v1`, and
   * `runSessionId` is the conversation ID so a future query can join the
   * candidate back to the originating Message.toolCalls audit trail.
   */
  const hasIncompleteVerdict = (result.verdicts ?? []).some((v) => v.code === 'incomplete');
  const shouldWriteCandidate =
    !abstained &&
    !hasIncompleteVerdict &&
    resolved.dataSource.mode === 'live';
  if (shouldWriteCandidate) {
    const draft = buildPendingIncidentCandidate({
      tenantId: user.tenantId,
      summary: result.text,
      toolCallsJson: persistedToolCalls as unknown as object,
      runSessionId: conversation.id,
    });
    await prisma.pendingIncidentCandidate.create({
      data: {
        tenantId: draft.tenantId,
        summary: draft.summary,
        toolCallsJson: draft.toolCallsJson as object,
        runSessionId: draft.runSessionId,
        proposedConfirmedAt: new Date(draft.proposedConfirmedAt),
        status: 'pending',
      },
    });
  }

  logRequest('POST', '/api/chat', 200, Date.now() - start);
  return NextResponse.json({
    reply: result.text,
    toolsUsed: persistedToolCalls.map((call) => ({ name: call.name, args: call.arguments })),
    conversationId: conversation.id,
    dataSource: resolved.dataSource,
    // Forwarded verbatim from `AgentResult.abstention` so the ChatUI can
    // render the warning bubble without re-parsing `Message.toolCalls`.
    abstention,
  });
}
