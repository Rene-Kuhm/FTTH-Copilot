/**
 * Next.js middleware for rate limiting and security headers.
 *
 * Applies rate limiting to all /api/* routes with:
 * - Normal routes: 100 req/min per tenant/IP
 * - Auth routes (/api/auth/*): 10 req/min (stricter)
 */
import { NextResponse, type NextRequest } from 'next/server';
import { verifyToken } from '@ftth-copilot/db';
import {
  checkRateLimit,
  getRateLimitKey,
  rateLimitResponse,
  RATE_LIMITS,
} from './middleware/rate-limit';

export const config = {
  matcher: '/api/:path*',
};

export function middleware(request: NextRequest): Response {
  const { pathname } = request.nextUrl;

  // Skip rate limiting for health checks
  if (pathname === '/api/health') {
    return NextResponse.next();
  }

  // Determine rate limit config based on route
  const isAuthRoute = pathname.startsWith('/api/auth');
  const limitConfig = isAuthRoute ? RATE_LIMITS.auth : RATE_LIMITS.normal;

  // Extract tenant ID from JWT if available
  let tenantId: string | undefined;
  const token = request.cookies.get('auth-token')?.value;
  if (token) {
    const claims = verifyToken(token);
    if (claims) {
      tenantId = claims.tenantId;
    }
  }

  // Check rate limit
  const key = getRateLimitKey(request, limitConfig.keyPrefix, tenantId);
  const result = checkRateLimit(key, limitConfig);

  // If rate limited, return 429
  if (!result.allowed) {
    return rateLimitResponse(result.resetAt);
  }

  // Add rate limit headers to response
  const response = NextResponse.next();
  response.headers.set('x-ratelimit-remaining', String(result.remaining));
  response.headers.set('x-ratelimit-reset', String(result.resetAt));

  // Add security headers
  response.headers.set('x-content-type-options', 'nosniff');
  response.headers.set('x-frame-options', 'DENY');
  response.headers.set('x-xss-protection', '1; mode=block');
  response.headers.set('referrer-policy', 'strict-origin-when-cross-origin');

  return response;
}
