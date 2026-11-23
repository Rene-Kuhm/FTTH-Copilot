/**
 * Shared authentication brute-force quota helpers.
 */
import { createLogger } from '@ftth-copilot/shared';
import {
  authRateLimitKeys,
  checkAuthQuota,
  recordAuthAttempt,
  releaseAuthQuota,
  reserveAuthQuota,
} from '@ftth-copilot/db';
import type {
  AuthQuotaOptions,
  AuthQuotaReservation,
  AuthRateLimitScope,
} from '@ftth-copilot/db';

const log = createLogger({ name: 'auth-quota' });

export const AUTH_QUOTA_ERROR_MESSAGE = 'Demasiados intentos. Probá de nuevo más tarde.';

function warnDegraded(action: string, err: unknown): void {
  log.warn(`Auth quota ${action} unavailable; degrading`, {
    error: err instanceof Error ? err.message : String(err),
  });
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Resolve rate-limit window and threshold from environment variables.
 */
export function authRateLimitOptions(): AuthQuotaOptions {
  return {
    max: positiveInt(process.env['AUTH_RATE_LIMIT_MAX'], 10),
    windowMs: positiveInt(process.env['AUTH_RATE_LIMIT_WINDOW_MS'], 15 * 60 * 1000),
  };
}

/**
 * Derive rate-limit bucket keys for an auth attempt (optional email, IP, and/or tx token).
 */
export function authQuotaKeys(
  email: string | null,
  clientIp: string | null,
  scope?: AuthRateLimitScope,
  transactionToken?: string | null,
): string[] {
  if (transactionToken !== undefined) {
    return authRateLimitKeys(email, clientIp, scope ?? 'login', transactionToken);
  }
  return scope === undefined
    ? authRateLimitKeys(email, clientIp)
    : authRateLimitKeys(email, clientIp, scope);
}

/**
 * Check all rate-limit keys and return the first denial, or allowed when all pass.
 * Fails closed on quota-store outages so DB errors never bypass rate limits.
 */
export async function checkAuthQuotaForKeys(
  keys: string[],
): Promise<{ allowed: boolean; retryAfter: number }> {
  const opts = authRateLimitOptions();
  try {
    for (const key of keys) {
      const decision = await checkAuthQuota(key, opts);
      if (!decision.allowed) {
        return { allowed: false, retryAfter: decision.retryAfter };
      }
    }
    return { allowed: true, retryAfter: 0 };
  } catch (err) {
    warnDegraded('check', err);
    return { allowed: false, retryAfter: Math.max(1, Math.ceil(opts.windowMs / 1000)) };
  }
}

/**
 * Record one failed authentication attempt across every rate-limit key.
 * Best-effort: swallows quota-store errors so the caller keeps its 401 response.
 */
export async function recordAuthFailures(keys: string[]): Promise<void> {
  const opts = authRateLimitOptions();
  try {
    for (const key of keys) {
      await recordAuthAttempt(key, opts);
    }
  } catch (err) {
    warnDegraded('failure recording', err);
  }
}

/**
 * Atomically reserve one attempt across every rate-limit key before
 * performing expensive credential verification. Fails closed on store outages.
 */
export async function reserveAuthQuotaForKeys(keys: string[]): Promise<AuthQuotaReservation> {
  const opts = authRateLimitOptions();
  try {
    return await reserveAuthQuota(keys, opts);
  } catch (err) {
    warnDegraded('reservation', err);
    return {
      allowed: false,
      retryAfter: Math.max(1, Math.ceil(opts.windowMs / 1000)),
      windowStart: new Date(),
    };
  }
}

/**
 * Refund a previously reserved attempt across `keys` when authentication
 * succeeds or delegates to the second-factor step.
 */
export async function releaseAuthQuotaForKeys(
  keys: string[],
  windowStart?: Date,
): Promise<void> {
  const opts = authRateLimitOptions();
  try {
    await releaseAuthQuota(keys, opts, undefined, windowStart);
  } catch (err) {
    warnDegraded('release', err);
  }
}
