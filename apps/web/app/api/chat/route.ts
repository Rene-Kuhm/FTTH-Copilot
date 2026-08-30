import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { runAgent } from '@ftth-copilot/agent-core';
import { prisma } from '@ftth-copilot/db';
import { getCurrentUser } from '@/lib/auth/server';
import { hasPermission } from '@/lib/auth/permissions';
import {
  ConnectorResolutionError,
  resolveTenantConnector,
} from '@/lib/connectors/chat-client';
import { consumeChatQuota } from '@/lib/rate-limit';
import { logRequest } from '@/lib/logging';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

  let resolved;
  try {
    resolved = await resolveTenantConnector({
      tenantId: user.tenantId,
      connectionId: conversation?.connectionId ?? connectionId,
    });
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

  let result;
  try {
    result = await runAgent({
      userMessage: message,
      conversationHistory: history,
      connector: resolved.connector,
      dataSource: resolved.dataSource,
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

  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      role: 'assistant',
      content: result.text,
      toolCalls: result.toolCalls.length > 0 ? (result.toolCalls as unknown as object) : undefined,
    },
  });

  for (const toolCall of result.toolCalls) {
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

  logRequest('POST', '/api/chat', 200, Date.now() - start);
  return NextResponse.json({
    reply: result.text,
    toolsUsed: result.toolCalls.map((call) => ({ name: call.name, args: call.arguments })),
    conversationId: conversation.id,
    dataSource: resolved.dataSource,
  });
}
