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
 * Derive rate-limit bucket keys for an auth attempt (email + optional client IP).
 */
export function authQuotaKeys(
  email: string,
  clientIp: string | null,
  scope?: AuthRateLimitScope,
): string[] {
  return scope === undefined
    ? authRateLimitKeys(email, clientIp)
    : authRateLimitKeys(email, clientIp, scope);
}

/**
 * Check all rate-limit keys and return the first denial, or allowed when all pass.
 * Fails open on quota-store outages so transient DB errors do not cause 500s.
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
    return { allowed: true, retryAfter: 0 };
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
 * performing expensive credential verification. Fails open with an epoch
 * sentinel windowStart so a failed reservation is never refunded later.
 */
export async function reserveAuthQuotaForKeys(keys: string[]): Promise<AuthQuotaReservation> {
  try {
    return await reserveAuthQuota(keys, authRateLimitOptions());
  } catch (err) {
    warnDegraded('reservation', err);
    return { allowed: true, retryAfter: 0, windowStart: new Date(0), counts: {} };
  }
}

/**
 * Refund a previously reserved attempt across `keys` when authentication
 * succeeds or delegates to the second-factor step. Skips epoch-sentinel
 * reservations and swallows quota-store errors.
 */
export async function releaseAuthQuotaForKeys(
  keys: string[],
  windowStart?: Date,
  counts?: Record<string, number>,
): Promise<void> {
  // Never refund a failed reservation that fell back to the epoch sentinel.
  if (windowStart?.getTime() === 0) return;
  const opts = authRateLimitOptions();
  try {
    await releaseAuthQuota(keys, opts, undefined, windowStart, counts);
  } catch (err) {
    warnDegraded('release', err);
  }
}
