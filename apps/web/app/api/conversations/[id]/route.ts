import { NextResponse } from 'next/server';
import { prisma } from '@ftth-copilot/db';
import { getCurrentUser } from '@/lib/auth/server';
import { hasPermission, type Permission } from '@/lib/auth/permissions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 });

  const { id } = await params;
  const canViewAll = hasPermission(
    user.role,
    'view_all_conversations' as Permission,
  );
  const conversation = await prisma.conversation.findFirst({
    where: {
      id,
      tenantId: user.tenantId,
      ...(canViewAll ? {} : { userId: user.id }),
    },
    select: {
      id: true,
      title: true,
      connectionId: true,
      messages: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          role: true,
          content: true,
          toolCalls: true,
          createdAt: true,
        },
      },
    },
  });

  if (!conversation) {
    return NextResponse.json({ error: 'Conversación no encontrada.' }, { status: 404 });
  }
  return NextResponse.json({ conversation });
}
