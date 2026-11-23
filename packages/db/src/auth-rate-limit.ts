/**
 * Brute-force protection for unauthenticated operations (login/signup).
 *
 * Unlike the chat quota (keyed by authenticated userId), these buckets are
 * keyed by arbitrary strings — a normalized email and/or a client IP — because
 * an attacker has not authenticated yet. The store is injectable so the logic
 * can be unit-tested without a database.
 */
import { randomUUID } from 'node:crypto';
import { Prisma } from './generated/client/index.js';
import { prisma } from './client';

export type AuthRateLimitScope = 'login' | 'mfa' | 'oidc';

export interface AuthQuotaOptions {
  max: number;
  windowMs: number;
}

export interface AuthQuotaReservation {
  allowed: boolean;
  retryAfter: number;
  windowStart: Date;
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

export interface AtomicAuthRateLimitStore extends AuthRateLimitStore {
  /** Atomically reserves one attempt across all `keys` if every key is below `max`. */
  reserve(keys: string[], windowStart: Date, expiresAt: Date, max: number): Promise<Array<{ key: string; count: number }>>;
  /** Refunds a reserved attempt for `keys` in `windowStart` (flooring at 0). */
  release(keys: string[], windowStart: Date): Promise<void>;
}

const prismaStore: AtomicAuthRateLimitStore = {
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
  async reserve(keys, windowStart, expiresAt, max) {
    const uniqueKeys = [...new Set(keys)].sort();
    if (uniqueKeys.length === 0) return [];
    return prisma.$transaction(async (tx) => {
      const lockExisting = () => tx.$queryRaw<Array<{ key: string; count: number }>>(Prisma.sql`
        SELECT "key", "count" FROM "auth_rate_limits"
        WHERE "windowStart" = ${windowStart} AND "key" IN (${Prisma.join(uniqueKeys)})
        ORDER BY "key" FOR UPDATE`);

      // Lock existing rows in key order before reading counts or creating missing buckets.
      let locked = await lockExisting();
      if (locked.some((r) => Number(r.count) >= max)) return [];
      if (locked.length < uniqueKeys.length) {
        const lockedKeys = new Set(locked.map((r) => r.key));
        const rows = uniqueKeys.filter((k) => !lockedKeys.has(k)).map((k) => Prisma.sql`(${randomUUID()}, ${k})`);
        await tx.$executeRaw(Prisma.sql`
          WITH candidate("id", "key") AS (VALUES ${Prisma.join(rows)})
          INSERT INTO "auth_rate_limits" ("id", "key", "windowStart", "expiresAt", "count")
          SELECT c."id", c."key", ${windowStart}, ${expiresAt}, 0 FROM candidate c
          ON CONFLICT ("key", "windowStart") DO NOTHING`);
        locked = await lockExisting();
        if (locked.length < uniqueKeys.length || locked.some((r) => Number(r.count) >= max)) return [];
      }
      const updated = await tx.$queryRaw<Array<{ key: string; count: number }>>(Prisma.sql`
        UPDATE "auth_rate_limits" SET "count" = "count" + 1
        WHERE "windowStart" = ${windowStart} AND "key" IN (${Prisma.join(uniqueKeys)})
        RETURNING "key", "count"`);
      return updated.map((r) => ({ key: r.key, count: Number(r.count) }));
    });
  },
  async release(keys, windowStart) {
    const uniqueKeys = [...new Set(keys)].sort();
    if (uniqueKeys.length === 0) return;
    await prisma.$transaction(async (tx) => {
      // Lock in key order before decrementing so refunds serialize with reservations.
      const locked = await tx.$queryRaw<Array<{ key: string }>>(Prisma.sql`
        SELECT "key" FROM "auth_rate_limits"
        WHERE "windowStart" = ${windowStart} AND "key" IN (${Prisma.join(uniqueKeys)})
        ORDER BY "key" FOR UPDATE`);
      if (locked.length === 0) return;
      await tx.$executeRaw(Prisma.sql`
        UPDATE "auth_rate_limits" SET "count" = GREATEST("count" - 1, 0)
        WHERE "windowStart" = ${windowStart} AND "key" IN (${Prisma.join(uniqueKeys)})`);
    });
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

/** Rate-limit keys for an auth operation: normalized email (when present) and IP (when present). */
export function authRateLimitKeys(
  email: string | null,
  ip: string | null,
  scope: AuthRateLimitScope = 'login',
): string[] {
  const keys: string[] = [];
  if (email !== null) {
    const normalized = email.trim().toLowerCase();
    if (normalized.length > 0) {
      keys.push(`${scope}:email:${normalized}`);
    }
  }
  if (ip) keys.push(`${scope}:ip:${ip}`);
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

/**
 * Atomically reserves one attempt across all `keys` in a single operation and
 * decides whether every bucket remains within `opts.max`.
 */
export async function reserveAuthQuota(
  keys: string[],
  opts: AuthQuotaOptions,
  store: AtomicAuthRateLimitStore = prismaStore,
  now: Date = new Date(),
): Promise<AuthQuotaReservation> {
  const windowStart = computeWindowStart(now, opts.windowMs);
  const uniqueKeys = [...new Set(keys)].sort();
  if (uniqueKeys.length === 0) return { allowed: true, retryAfter: 0, windowStart };
  const windowEnd = new Date(windowStart.getTime() + opts.windowMs);
  const reserved = await store.reserve(uniqueKeys, windowStart, windowEnd, opts.max);
  const counts = Object.fromEntries(reserved.map((r) => [r.key, r.count]));
  if (reserved.length === uniqueKeys.length && uniqueKeys.every((k) => (counts[k] ?? opts.max + 1) <= opts.max)) {
    return { allowed: true, retryAfter: 0, windowStart };
  }
  const reservedKeys = [...new Set(reserved.map((r) => r.key))];
  if (reservedKeys.length > 0) await store.release(reservedKeys, windowStart);
  return { allowed: false, retryAfter: retryAfterSeconds(now, windowStart, opts.windowMs), windowStart };
}

/**
 * Refunds a previously reserved attempt across `keys` (flooring at 0) when
 * authentication succeeds.
 */
export async function releaseAuthQuota(
  keys: string[],
  opts: AuthQuotaOptions,
  store: AtomicAuthRateLimitStore = prismaStore,
  windowStart: Date = computeWindowStart(new Date(), opts.windowMs),
): Promise<void> {
  const uniqueKeys = [...new Set(keys)].sort();
  if (uniqueKeys.length === 0) return;
  await store.release(uniqueKeys, windowStart);
}
