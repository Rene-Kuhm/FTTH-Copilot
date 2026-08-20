import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@ftth-copilot/db';
import { getCurrentUser } from '@/lib/auth/server';
import { hasPermission, type Permission } from '@/lib/auth/permissions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const updateUserSchema = z.object({
  role: z.enum(['OWNER', 'ADMIN', 'OPERATOR']),
});

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  if (!hasPermission(user.role, 'manage_users' as Permission)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  // Only OWNER can change roles
  if (user.role !== 'OWNER') {
    return NextResponse.json({ error: 'Only OWNER can change user roles' }, { status: 403 });
  }

  // Cannot change own role
  if (id === user.id) {
    return NextResponse.json({ error: 'Cannot change your own role' }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const parsed = updateUserSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // Target user must belong to same tenant
  const target = await prisma.user.findFirst({
    where: { id, tenantId: user.tenantId },
  });
  if (!target) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const updated = await prisma.user.update({
    where: { id },
    data: { role: parsed.data.role },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ user: updated });
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  if (!hasPermission(user.role, 'manage_users' as Permission)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  // Only OWNER can delete users
  if (user.role !== 'OWNER') {
    return NextResponse.json({ error: 'Only OWNER can delete users' }, { status: 403 });
  }

  // Cannot delete self
  if (id === user.id) {
    return NextResponse.json({ error: 'Cannot delete yourself' }, { status: 400 });
  }

  // Target user must belong to same tenant
  const target = await prisma.user.findFirst({
    where: { id, tenantId: user.tenantId },
  });
  if (!target) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  await prisma.user.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
