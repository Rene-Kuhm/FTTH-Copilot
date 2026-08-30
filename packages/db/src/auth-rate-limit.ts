/**
 * Brute-force protection for unauthenticated operations (login/signup).
 *
 * Unlike the chat quota (keyed by authenticated userId), these buckets are
 * keyed by arbitrary strings — a normalized email and/or a client IP — because
 * an attacker has not authenticated yet. The store is injectable so the logic
 * can be unit-tested without a database.
 */
import { prisma } from './client';

export interface AuthQuotaOptions {
  max: number;
  windowMs: number;
}

export interface AuthRateLimitStore {
  /** Current bucket for (key, windowStart), or null if none. */
  findCount(
    key: string,
    windowStart: Date,
  ): Promise<{ count: number; expiresAt: Date } | null>;
  /** Atomically increments the bucket and returns the resulting count. */
  increment(key: string, windowStart: Date, expiresAt: Date): Promise<number>;
}

const prismaStore: AuthRateLimitStore = {
  async findCount(key, windowStart) {
    return prisma.authRateLimit.findUnique({
      where: { key_windowStart: { key, windowStart } },
      select: { count: true, expiresAt: true },
    });
  },
  async increment(key, windowStart, expiresAt) {
    const bucket = await prisma.authRateLimit.upsert({
      where: { key_windowStart: { key, windowStart } },
      create: { key, windowStart, expiresAt, count: 1 },
      update: { count: { increment: 1 } },
      select: { count: true },
    });
    return bucket.count;
  },
};

/** Start of the fixed window containing `now` for the given window length. */
export function computeWindowStart(now: Date, windowMs: number): Date {
  return new Date(Math.floor(now.getTime() / windowMs) * windowMs);
}

/** First (leftmost) value of an X-Forwarded-For header, or null. */
export function extractClientIp(xForwardedFor: string | null | undefined): string | null {
  if (!xForwardedFor) return null;
  const first = xForwardedFor.split(',')[0]?.trim();
  return first && first.length > 0 ? first : null;
}

/** Rate-limit keys for a login attempt: always email, plus IP when present. */
export function authRateLimitKeys(email: string, ip: string | null): string[] {
  const keys = [`login:email:${email.trim().toLowerCase()}`];
  if (ip) keys.push(`login:ip:${ip}`);
  return keys;
}

function retryAfterSeconds(now: Date, windowStart: Date, windowMs: number): number {
  return Math.max(1, Math.ceil((windowStart.getTime() + windowMs - now.getTime()) / 1000));
}

/**
 * Read-only check of the current bucket for `key`. Does not mutate state; use
 * it as a cheap pre-flight before expensive work (e.g. bcrypt).
 */
export async function checkAuthQuota(
  key: string,
  opts: AuthQuotaOptions,
  store: AuthRateLimitStore = prismaStore,
  now: Date = new Date(),
): Promise<{ allowed: boolean; retryAfter: number }> {
  const windowStart = computeWindowStart(now, opts.windowMs);
  const bucket = await store.findCount(key, windowStart);
  const count = bucket && bucket.expiresAt.getTime() > now.getTime() ? bucket.count : 0;
  if (count < opts.max) return { allowed: true, retryAfter: 0 };
  return { allowed: false, retryAfter: retryAfterSeconds(now, windowStart, opts.windowMs) };
}

/**
 * Records one attempt and reports whether it pushed the bucket over the limit.
 */
export async function recordAuthAttempt(
  key: string,
  opts: AuthQuotaOptions,
  store: AuthRateLimitStore = prismaStore,
  now: Date = new Date(),
): Promise<{ allowed: boolean; retryAfter: number }> {
  const windowStart = computeWindowStart(now, opts.windowMs);
  const windowEnd = new Date(windowStart.getTime() + opts.windowMs);
  const count = await store.increment(key, windowStart, windowEnd);
  if (count <= opts.max) return { allowed: true, retryAfter: 0 };
  return { allowed: false, retryAfter: retryAfterSeconds(now, windowStart, opts.windowMs) };
}
