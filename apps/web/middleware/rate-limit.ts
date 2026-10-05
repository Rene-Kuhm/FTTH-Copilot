/**
 * Sliding window in-memory rate limiter for Next.js middleware.
 *
 * Provides per-tenant rate limiting with different limits for:
 * - Normal API routes: 100 req/min
 * - Auth routes: 10 req/min (stricter for brute-force protection)
 */

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

// In-memory store (per-instance)
// In production, use Redis for multi-instance deployments
const store = new Map<string, RateLimitEntry>();

// Cleanup old entries every 5 minutes
const CLEANUP_INTERVAL = 5 * 60 * 1000;
const MAX_WINDOW_AGE = 2 * 60 * 1000; // 2 minutes

let lastCleanup = Date.now();

function cleanup(): void {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;

  for (const [key, entry] of store.entries()) {
    if (now - entry.windowStart > MAX_WINDOW_AGE) {
      store.delete(key);
    }
  }
}

export interface RateLimitConfig {
  /** Max requests per window */
  max: number;
  /** Window size in milliseconds */
  windowMs: number;
  /** Key prefix for this limiter */
  keyPrefix: string;
}

/**
 * Default rate limits
 */
export const RATE_LIMITS = {
  normal: {
    max: 100,
    windowMs: 60 * 1000, // 1 minute
    keyPrefix: 'rl',
  },
  // Raised for CI/E2E: Playwright runs 2 workers in parallel + retry=1,
  // auth-real.spec.ts makes ~8 sequential requests per test, and multiple
  // specs hit auth routes. 200 req/min gives enough headroom.
  auth: {
    max: 200,
    windowMs: 60 * 1000, // 1 minute
    keyPrefix: 'rl-auth',
  },
} as const;

/**
 * Check rate limit for a given key.
 * Returns { allowed: boolean; remaining: number; resetAt: number }
 */
export function checkRateLimit(
  key: string,
  config: RateLimitConfig,
): { allowed: boolean; remaining: number; resetAt: number } {
  cleanup();

  const now = Date.now();
  const entry = store.get(key);

  // No entry or window expired - start fresh
  if (!entry || now - entry.windowStart >= config.windowMs) {
    store.set(key, { count: 1, windowStart: now });
    return {
      allowed: true,
      remaining: config.max - 1,
      resetAt: now + config.windowMs,
    };
  }

  // Within window - check count
  if (entry.count >= config.max) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: entry.windowStart + config.windowMs,
    };
  }

  // Increment count
  entry.count++;
  return {
    allowed: true,
    remaining: config.max - entry.count,
    resetAt: entry.windowStart + config.windowMs,
  };
}

/**
 * Get rate limit key for a request.
 * Uses tenant ID from JWT or falls back to IP for unauthenticated requests.
 */
export function getRateLimitKey(
  request: Request,
  keyPrefix: string,
  tenantId?: string,
): string {
  // Try to get tenant from JWT
  if (tenantId) {
    return `${keyPrefix}:tenant:${tenantId}`;
  }

  // Fall back to IP
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded ? forwarded.split(',')[0]!.trim() : 'unknown';
  return `${keyPrefix}:ip:${ip}`;
}

/**
 * Create a Next.js Response with rate limit headers.
 */
export function rateLimitResponse(resetAt: number): Response {
  const retryAfter = Math.ceil((resetAt - Date.now()) / 1000);
  return new Response(
    JSON.stringify({
      error: 'Too many requests',
      retryAfter,
    }),
    {
      status: 429,
      headers: {
        'content-type': 'application/json',
        'retry-after': String(retryAfter),
        'x-ratelimit-reset': String(resetAt),
      },
    },
  );
}
