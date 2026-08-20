import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { runAgent } from '@ftth-copilot/agent-core';
import { prisma } from '@ftth-copilot/db';
import { getCurrentUser } from '@/lib/auth/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ChatBody {
  message: string;
  conversationId?: string;
}

const bodySchema = z.object({
  message: z.string().min(1).max(8000),
  conversationId: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { message, conversationId } = parsed.data;

  // Identify user (auth) — current state: optional for demo.
  const user = await getCurrentUser();

  // Persist: ensure conversation exists and belongs to this user/tenant.
  let conversation;
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
  }

  // Run agent (uses the mock SmartOLT connector for now).
  // TODO: switch to a real connector driven by user.tenantId + their NmsConnection.
  let result;
  try {
    result = await runAgent({ userMessage: message });
  } catch (err) {
    console.error('[ftth-copilot/api/chat] agent error', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }

  // Persist agent response if user is authenticated.
  if (user && conversation) {
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: 'assistant',
        content: result.text,
        toolCalls: result.toolCalls.length > 0 ? (result.toolCalls as unknown as object) : undefined,
      },
    });
    // Log each tool call for the audit trail.
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

  return NextResponse.json({
    reply: result.text,
    toolsUsed: result.toolCalls.map((c) => ({ name: c.name, args: c.arguments })),
    conversationId: conversation?.id,
  });
}
