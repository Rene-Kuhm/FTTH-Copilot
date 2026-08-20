import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@ftth-copilot/db';
import { getCurrentUser } from '@/lib/auth/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { id } = await params;
  const conversation = await prisma.conversation.findFirst({
    where: { id, tenantId: user.tenantId },
    include: {
      messages: { orderBy: { createdAt: 'asc' } },
    },
  });

  if (!conversation) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const url = new URL(req.url);
  const format = url.searchParams.get('format') ?? 'json';

  if (format === 'text') {
    const lines: string[] = [];
    lines.push(`Conversacion: ${conversation.title ?? 'Sin titulo'}`);
    lines.push(`Fecha: ${conversation.createdAt.toISOString()}`);
    lines.push(`ID: ${conversation.id}`);
    lines.push('---');
    lines.push('');
    for (const msg of conversation.messages) {
      const role = msg.role === 'user' ? 'Usuario' : msg.role === 'assistant' ? 'Asistente' : 'Tool';
      const ts = msg.createdAt.toLocaleString('es-AR');
      lines.push(`[${ts}] ${role}:`);
      lines.push(msg.content);
      lines.push('');
    }
    const text = lines.join('\n');
    return new NextResponse(text, {
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'content-disposition': `attachment; filename="ftth-conversation-${id}.txt"`,
      },
    });
  }

  // JSON format
  return NextResponse.json({
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    messages: conversation.messages.map((m) => ({
      role: m.role,
      content: m.content,
      toolCalls: m.toolCalls,
      createdAt: m.createdAt,
    })),
  });
}
