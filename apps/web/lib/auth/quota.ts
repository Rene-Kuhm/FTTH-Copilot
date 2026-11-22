/**
 * Shared authentication brute-force quota helpers.
 */
import {
  authRateLimitKeys,
  checkAuthQuota,
  recordAuthAttempt,
} from '@ftth-copilot/db';
import type { AuthQuotaOptions } from '@ftth-copilot/db';

export const AUTH_QUOTA_ERROR_MESSAGE = 'Demasiados intentos. Probá de nuevo más tarde.';

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
 * Derive rate-limit bucket keys for a login attempt (email + optional client IP).
 */
export function authQuotaKeys(email: string, clientIp: string | null): string[] {
  return authRateLimitKeys(email, clientIp);
}

/**
 * Check all rate-limit keys and return the first denial, or allowed when all pass.
 */
export async function checkAuthQuotaForKeys(
  keys: string[],
): Promise<{ allowed: boolean; retryAfter: number }> {
  const opts = authRateLimitOptions();
  for (const key of keys) {
    const decision = await checkAuthQuota(key, opts);
    if (!decision.allowed) {
      return { allowed: false, retryAfter: decision.retryAfter };
    }
  }
  return { allowed: true, retryAfter: 0 };
}

/**
 * Record one failed authentication attempt across every rate-limit key.
 */
export async function recordAuthFailures(keys: string[]): Promise<void> {
  const opts = authRateLimitOptions();
  for (const key of keys) {
    await recordAuthAttempt(key, opts);
  }
}
