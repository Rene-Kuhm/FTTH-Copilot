import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { runAgent } from '@ftth-copilot/agent-core';
import { prisma } from '@ftth-copilot/db';
import { getCurrentUser } from '@/lib/auth/server';
import { ChatOltClient } from '@/lib/connectors/chat-client';
import { logRequest } from '@/lib/logging';
import type { INmsConnector } from '@ftth-copilot/connectors-core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  message: z.string().min(1).max(8000),
  conversationId: z.string().optional(),
});

export async function POST(req: NextRequest) {
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
  const { message, conversationId } = parsed.data;

  const user = await getCurrentUser();

  let conversation;
  let connectorForChat: INmsConnector | null = null;
  if (user) {
    if (conversationId) {
      conversation = await prisma.conversation.findFirst({
        where: { id: conversationId, tenantId: user.tenantId, userId: user.id },
      });
    }
    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: {
          tenantId: user.tenantId,
          userId: user.id,
          title: message.slice(0, 80),
        },
      });
    }
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: 'user',
        content: message,
      },
    });
    connectorForChat = await ChatOltClient.forTenant(user.tenantId);
  }

  let result;
  try {
    result = await runAgent({
      userMessage: message,
      connector: connectorForChat ?? undefined,
    });
  } catch (err) {
    console.error('[ftth-copilot/api/chat] agent error', err);
    logRequest('POST', '/api/chat', 500, Date.now() - start);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }

  if (user && conversation) {
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: 'assistant',
        content: result.text,
        toolCalls: result.toolCalls.length > 0 ? (result.toolCalls as unknown as object) : undefined,
      },
    });
    for (const tc of result.toolCalls) {
      await prisma.agentActionLog.create({
        data: {
          tenantId: user.tenantId,
          userId: user.id,
          conversationId: conversation.id,
          toolName: tc.name,
          parameters: tc.arguments as unknown as object,
          result: (tc.result as unknown as object) ?? undefined,
          durationMs: 0,
        },
      });
    }
  }

  logRequest('POST', '/api/chat', 200, Date.now() - start);
  return NextResponse.json({
    reply: result.text,
    toolsUsed: result.toolCalls.map((c) => ({ name: c.name, args: c.arguments })),
    conversationId: conversation?.id,
  });
}
