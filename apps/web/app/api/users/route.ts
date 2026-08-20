import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@ftth-copilot/db';
import { getCurrentUser } from '@/lib/auth/server';
import { hasPermission, type Permission } from '@/lib/auth/permissions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createUserSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(120).optional(),
  role: z.enum(['OWNER', 'ADMIN', 'OPERATOR']),
});

export async function GET(): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  if (!hasPermission(user.role, 'manage_users' as Permission)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const users = await prisma.user.findMany({
    where: { tenantId: user.tenantId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  return NextResponse.json({ users });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  if (!hasPermission(user.role, 'manage_users' as Permission)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = createUserSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { email, password, name, role } = parsed.data;

  // Non-OWNER cannot create OWNER users
  if (role === 'OWNER' && user.role !== 'OWNER') {
    return NextResponse.json({ error: 'Only OWNER can create OWNER users' }, { status: 403 });
  }

  // Check email uniqueness within tenant
  const existing = await prisma.user.findFirst({
    where: { email, tenantId: user.tenantId },
  });
  if (existing) {
    return NextResponse.json({ error: 'Email already in use in this tenant' }, { status: 409 });
  }

  const { hashPassword } = await import('@ftth-copilot/db');
  const passwordHash = await hashPassword(password);

  const created = await prisma.user.create({
    data: {
      email,
      name: name ?? null,
      passwordHash,
      role,
      tenantId: user.tenantId,
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ user: created }, { status: 201 });
}
