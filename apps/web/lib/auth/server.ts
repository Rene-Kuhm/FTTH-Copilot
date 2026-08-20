/**
 * Server-side auth helpers for the demo.
 * In production this would live in packages/auth. For now colocated here.
 */
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  hashPassword,
  verifyPassword,
  issueToken,
  verifyToken,
  hashToken,
  prisma,
  COOKIE_NAME,
  sessionCookieAttributes,
  TOKEN_TTL_SECONDS,
  type SessionClaims,
} from '@ftth-copilot/db';

export const runtime = 'nodejs';

const emailSchema = z.string().email().max(254);
const passwordSchema = z.string().min(8).max(128);
const nameSchema = z.string().min(1).max(120);

const signupSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: nameSchema.optional(),
  tenantName: z.string().min(1).max(120),
});

const loginSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

export interface CurrentUser {
  id: string;
  email: string;
  name: string | null;
  role: 'OWNER' | 'MEMBER';
  tenantId: string;
  tenant: { id: string; name: string; slug: string };
}

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new NextResponse(JSON.stringify(body), {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...init?.headers,
    },
  });
}

function setSessionCookie(token: string): string {
  const attrs = sessionCookieAttributes();
  const parts = [
    `${COOKIE_NAME}=${token}`,
    `Max-Age=${TOKEN_TTL_SECONDS}`,
    `Path=${attrs.path}`,
    'HttpOnly',
  ];
  if (attrs.sameSite === 'lax') parts.push('SameSite=Lax');
  if (attrs.sameSite === 'strict') parts.push('SameSite=Strict');
  if (attrs.secure) parts.push('Secure');
  return parts.join('; ');
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'tenant';
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

export async function handleSignup(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = signupSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 });
  }
  const { email, password, name, tenantName } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return jsonResponse({ error: 'Email already registered' }, { status: 409 });
  }

  const passwordHash = await hashPassword(password);

  const { user, tenant } = await prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({
      data: { name: tenantName, slug: `${slugify(tenantName)}-${randomSuffix()}` },
    });
    const user = await tx.user.create({
      data: { email, name: name ?? null, passwordHash, role: 'OWNER', tenantId: tenant.id },
    });
    // Auto-create a default mock connector so the user has something to see
    // in the ConnectorManager UI. The chat still uses mock fixtures as
    // fallback when no real connector is configured.
    await tx.nmsConnection.create({
      data: {
        tenantId: tenant.id,
        provider: 'SMARTOLT',
        label: 'SmartOLT (demo)',
        encryptedKey: 'mock-placeholder',
        encryptionMeta: 'mock-iv',
        status: 'pending',
      },
    });
    return { user, tenant };
  });

  const { token, tokenHash, expiresAt } = issueToken(user.id, tenant.id, user.role);
  await prisma.session.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt,
      userAgent: req.headers.get('user-agent') ?? null,
      ipAddress: req.headers.get('x-forwarded-for') ?? null,
    },
  });

  return jsonResponse(
    {
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
    },
    {
      status: 201,
      headers: { 'set-cookie': setSessionCookie(token) },
    },
  );
}

export async function handleLogin(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 });
  }
  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return jsonResponse({ error: 'Invalid credentials' }, { status: 401 });
  }
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    return jsonResponse({ error: 'Invalid credentials' }, { status: 401 });
  }

  const { token, tokenHash, expiresAt } = issueToken(user.id, user.tenantId, user.role);
  await prisma.session.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt,
      userAgent: req.headers.get('user-agent') ?? null,
      ipAddress: req.headers.get('x-forwarded-for') ?? null,
    },
  });

  return jsonResponse(
    { user: { id: user.id, email: user.email, name: user.name, role: user.role } },
    {
      status: 200,
      headers: { 'set-cookie': setSessionCookie(token) },
    },
  );
}

export async function handleLogout(req: Request) {
  const cookieHeader = req.headers.get('cookie') ?? '';
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  const token = match?.[1];
  if (token) {
    const tokenHash = hashToken(token);
    await prisma.session.deleteMany({ where: { tokenHash } }).catch(() => {});
  }
  const res = NextResponse.json({ ok: true });
  // Clear cookie
  const attrs = sessionCookieAttributes();
  const parts = [
    `${COOKIE_NAME}=`,
    'Max-Age=0',
    `Path=${attrs.path}`,
    'HttpOnly',
  ];
  if (attrs.sameSite === 'lax') parts.push('SameSite=Lax');
  res.headers.set('set-cookie', parts.join('; '));
  return res;
}

export async function handleMe(req: Request): Promise<NextResponse> {
  const cookieHeader = req.headers.get('cookie') ?? '';
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  const token = match?.[1];
  if (!token) {
    return jsonResponse({ user: null });
  }
  const claims = verifyToken(token);
  if (!claims) {
    return jsonResponse({ user: null });
  }
  const user = await prisma.user.findUnique({
    where: { id: claims.sub },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      tenantId: true,
      tenant: { select: { id: true, name: true, slug: true } },
    },
  });
  if (!user) {
    return jsonResponse({ user: null });
  }
  return jsonResponse({ user });
}

/**
 * Helper for protected routes: extract current user from cookies or return null.
 * Use this in other API routes that require auth.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  const claims = verifyToken(token);
  if (!claims) return null;
  const user = await prisma.user.findUnique({
    where: { id: claims.sub },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      tenantId: true,
      tenant: { select: { id: true, name: true, slug: true } },
    },
  });
  return user;
}
