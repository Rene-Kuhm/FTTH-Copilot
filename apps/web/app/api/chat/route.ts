import { NextRequest, NextResponse } from 'next/server';
import { runAgent } from '@ftth-copilot/agent-core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SYSTEM_LOG = '[ftth-copilot/api/chat]';

interface ChatBody {
  message: string;
  conversationId?: string;
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as ChatBody;
  const { message, conversationId } = body;

  if (!message || typeof message !== 'string') {
    return NextResponse.json(
      { error: 'message is required and must be a string' },
      { status: 400 },
    );
  }

  if (!process.env.MINIMAX_API_KEY) {
    return NextResponse.json(
      {
        error:
          'MINIMAX_API_KEY no está configurada. Copiá .env.example a .env y completá la key.',
      },
      { status: 500 },
    );
  }

  console.log(`${SYSTEM_LOG} message received`, {
    conversationId,
    length: message.length,
  });

  try {
    const result = await runAgent({ userMessage: message });

    return NextResponse.json({
      reply: result.text,
      toolsUsed: result.toolCalls.map((c) => ({
        name: c.name,
        args: c.arguments,
      })),
      conversationId: conversationId ?? crypto.randomUUID(),
    });
  } catch (err) {
    console.error(`${SYSTEM_LOG} agent error`, err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : 'Error desconocido',
      },
      { status: 500 },
    );
  }
}
