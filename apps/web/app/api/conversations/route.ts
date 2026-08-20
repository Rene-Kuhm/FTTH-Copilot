import { NextResponse } from 'next/server';
import { prisma } from '@ftth-copilot/db';
import { getCurrentUser } from '@/lib/auth/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ conversations: [] });
  }

  const conversations = await prisma.conversation.findMany({
    where: { tenantId: user.tenantId, userId: user.id },
    orderBy: { updatedAt: 'desc' },
    take: 50,
    select: {
      id: true,
      title: true,
      updatedAt: true,
      createdAt: true,
      _count: { select: { messages: true } },
    },
  });

  return NextResponse.json({
    conversations: conversations.map((c) => ({
      id: c.id,
      title: c.title ?? 'Sin título',
      updatedAt: c.updatedAt,
      createdAt: c.createdAt,
      messageCount: c._count.messages,
    })),
  });
}
