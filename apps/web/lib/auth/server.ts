/**
 * Server-side auth helpers for the demo.
 * In production this would live in packages/auth. For now colocated here.
 */
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
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
  checkAuthQuota,
  recordAuthAttempt,
  authRateLimitKeys,
  extractClientIp,
} from '@ftth-copilot/db';
import type { Role, AuthQuotaOptions } from '@ftth-copilot/db';

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

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function authRateLimitOptions(): AuthQuotaOptions {
  return {
    max: positiveInt(process.env['AUTH_RATE_LIMIT_MAX'], 10),
    windowMs: positiveInt(process.env['AUTH_RATE_LIMIT_WINDOW_MS'], 15 * 60 * 1000),
  };
}

async function recordFailedLogins(keys: string[]): Promise<void> {
  const opts = authRateLimitOptions();
  for (const key of keys) {
    await recordAuthAttempt(key, opts);
  }
}

export interface CurrentUser {
  id: string;
  email: string;
  name: string | null;
  role: Role;
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
  // Unpredictable suffix (crypto), not Math.random — tenant slugs are
  // externally visible and should not be guessable.
  return randomBytes(3).toString('hex');
}

function describeError(err: unknown): { kind: string; message: string; stack?: string } {
  if (err instanceof Error) {
    const code = (err as { code?: string }).code;
    return {
      kind: code ?? err.constructor.name,
      message: err.message,
      stack: err.stack,
    };
  }
  return { kind: 'Unknown', message: String(err) };
}

export async function handleSignup(req: Request) {
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = signupSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse(
      { error: 'Invalid input', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { email, password, name, tenantName } = parsed.data;

  // Rate-limit account creation per client IP to block mass signup and email
  // enumeration abuse.
  const clientIp = extractClientIp(req.headers.get('x-forwarded-for'));
  if (clientIp) {
    const key = `signup:ip:${clientIp}`;
    const opts = authRateLimitOptions();
    const decision = await checkAuthQuota(key, opts);
    if (!decision.allowed) {
      return jsonResponse(
        { error: 'Demasiados registros. Probá de nuevo más tarde.' },
        { status: 429, headers: { 'retry-after': String(decision.retryAfter) } },
      );
    }
    await recordAuthAttempt(key, opts);
  }

  try {
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
      return { user, tenant };
    });

    const { token, tokenHash, expiresAt } = issueToken(user.id, tenant.id, user.role);
    await prisma.session.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
        userAgent: req.headers.get('user-agent') ?? null,
        ipAddress: extractClientIp(req.headers.get('x-forwarded-for')),
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
  } catch (err) {
    const info = describeError(err);
    console.error('[auth.signup] failed', {
      kind: info.kind,
      message: info.message,
      stack: info.stack,
    });
    return jsonResponse(
      { error: 'Signup failed' },
      { status: 500 },
    );
  }
}

export async function handleLogin(req: Request) {
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse(
      { error: 'Invalid input', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { email, password } = parsed.data;

  // Brute-force guard: reject early when this email or IP is already over its
  // failure budget, and record failures on the slow paths below.
  const clientIp = extractClientIp(req.headers.get('x-forwarded-for'));
  const rateKeys = authRateLimitKeys(email, clientIp);
  const rateOpts = authRateLimitOptions();
  for (const key of rateKeys) {
    const decision = await checkAuthQuota(key, rateOpts);
    if (!decision.allowed) {
      return jsonResponse(
        { error: 'Demasiados intentos. Probá de nuevo más tarde.' },
        { status: 429, headers: { 'retry-after': String(decision.retryAfter) } },
      );
    }
  }

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      await recordFailedLogins(rateKeys);
      return jsonResponse({ error: 'Invalid credentials' }, { status: 401 });
    }
    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) {
      await recordFailedLogins(rateKeys);
      return jsonResponse({ error: 'Invalid credentials' }, { status: 401 });
    }

    const { token, tokenHash, expiresAt } = issueToken(user.id, user.tenantId, user.role);
    await prisma.session.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
        userAgent: req.headers.get('user-agent') ?? null,
        ipAddress: extractClientIp(req.headers.get('x-forwarded-for')),
      },
    });

    return jsonResponse(
      { user: { id: user.id, email: user.email, name: user.name, role: user.role } },
      {
        status: 200,
        headers: { 'set-cookie': setSessionCookie(token) },
      },
    );
  } catch (err) {
    const info = describeError(err);
    console.error('[auth.login] failed', {
      kind: info.kind,
      message: info.message,
      stack: info.stack,
    });
    return jsonResponse(
      { error: 'Login failed' },
      { status: 500 },
    );
  }
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
  const user = await getUserForSessionToken(token);
  if (!user) return jsonResponse({ user: null });
  return jsonResponse({ user });
}

async function getUserForSessionToken(token: string): Promise<CurrentUser | null> {
  const claims = verifyToken(token);
  if (!claims) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      userId: true,
      expiresAt: true,
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          tenantId: true,
          tenant: { select: { id: true, name: true, slug: true } },
        },
      },
    },
  });
  if (!session || session.expiresAt <= new Date()) return null;
  if (session.userId !== claims.sub || session.user.tenantId !== claims.tenantId) return null;
  return session.user;
}

/**
 * Helper for protected routes: extract current user from cookies or return null.
 * Use this in other API routes that require auth.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return getUserForSessionToken(token);
}
