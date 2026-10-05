/**
 * Centralized middleware for auth, rate limiting, and security headers.
 *
 * Protection model:
 * - /api/*       → rate limiting + security headers (auth handled per-route)
 * - /dashboard/* → auth required (redirect to /login if unauthenticated)
 * - /admin/*     → auth + ADMIN/OWNER role required
 * - /settings/*  → auth required
 * - /plans/*     → auth required
 * - /alerts/*    → auth required
 * - /login       → public
 * - /signup      → public
 * - /            → public
 * - /api/health   → public (rate limit skipped)
 *
 * RBAC at middleware level:
 * - Only checks minimum authentication (token valid)
 * - Granular permissions (hasPermission checks) are done at API route level
 * - Role is passed in headers for server components
 *
 * Test bypass:
 * - For E2E tests, use cookie: __test_bypass=true
 */
import { NextResponse, type NextRequest } from 'next/server';
import { verifyToken, type MiddlewareClaims } from './middleware/jwt-verify';
import {
  checkRateLimit,
  getRateLimitKey,
  rateLimitResponse,
  RATE_LIMITS,
} from './middleware/rate-limit';
import { validateCsrfToken } from './lib/auth/csrf';

export const config = {
  matcher: [
    /*
     * Match all request paths EXCEPT:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico
     * - public files
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff|woff2|ttf|otf)).*)',
  ],
};

// Routes that don't require authentication
const PUBLIC_PREFIXES = [
  '/login',
  '/signup',
  '/api/auth',      // Auth endpoints handle their own
  '/api/health',    // Health check
  '/api/docs',      // API docs if public
] as const;

const PUBLIC_PATHS = ['/', '/manifest.json', '/sw.js'] as const;

// Admin routes require ADMIN or OWNER role
const ADMIN_PREFIXES = ['/admin', '/dashboard/admin'] as const;

function isPublicPath(pathname: string): boolean {
  // Exact matches
  if ((PUBLIC_PATHS as readonly string[]).includes(pathname)) return true;

  // Prefix matches
  return (PUBLIC_PREFIXES as readonly string[]).some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function isAdminRoute(pathname: string): boolean {
  return (ADMIN_PREFIXES as readonly string[]).some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function classifyRoute(pathname: string): 'api' | 'admin' | 'protected' | 'public' {
  if (pathname.startsWith('/api/')) return 'api';
  if (isPublicPath(pathname)) return 'public';
  if (isAdminRoute(pathname)) return 'admin';
  return 'protected';
}

const ROLE_HIERARCHY: Record<string, number> = {
  OWNER: 4,
  ADMIN: 3,
  OPERATOR: 2,
  MEMBER: 2, // MEMBER treated as OPERATOR
};

function hasMinimumRole(userRole: string, minimumRole: string): boolean {
  const userLevel = ROLE_HIERARCHY[userRole] ?? 0;
  const minimumLevel = ROLE_HIERARCHY[minimumRole] ?? 0;
  return userLevel >= minimumLevel;
}

export function middleware(request: NextRequest): Response {
  const pathname = request.nextUrl.pathname;
  const classification = classifyRoute(pathname);

  // ── API Routes: Rate Limiting + Security Headers ──────────────────────────
  if (classification === 'api') {
    // Skip rate limiting for health checks
    if (pathname === '/api/health') {
      return NextResponse.next();
    }

    // CSRF Protection for mutations (POST, PUT, DELETE, PATCH)
    const method = request.method.toUpperCase();
    const isMutation = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method);
    if (isMutation) {
      // Skip CSRF for auth endpoints (they handle their own validation)
      if (!pathname.startsWith('/api/auth')) {
        const csrfValid = validateCsrfToken(
          request.headers.get('cookie'),
          request.headers.get('x-csrf-token'),
        );
        if (!csrfValid) {
          const errorResponse = new NextResponse(
            JSON.stringify({ error: 'Invalid CSRF token' }),
            { status: 403, headers: { 'content-type': 'application/json' } },
          );
          addSecurityHeaders(errorResponse);
          return errorResponse;
        }
      }
    }

    const isAuthRoute = pathname.startsWith('/api/auth');
    const limitConfig = isAuthRoute ? RATE_LIMITS.auth : RATE_LIMITS.normal;

    // Extract tenant ID from JWT for per-tenant rate limiting
    let tenantId: string | undefined;
    const token = request.cookies.get('ftth_session')?.value;
    if (token) {
      const claims = verifyToken(token);
      if (claims) {
        tenantId = claims.tenantId;
      }
    }

    const key = getRateLimitKey(request, limitConfig.keyPrefix, tenantId);
    const result = checkRateLimit(key, limitConfig);

    if (!result.allowed) {
      return rateLimitResponse(result.resetAt);
    }

    const response = NextResponse.next();
    addSecurityHeaders(response);
    response.headers.set('x-ratelimit-remaining', String(result.remaining));
    response.headers.set('x-ratelimit-reset', String(result.resetAt));
    return response;
  }

  // ── Admin Routes: Auth + ADMIN/OWNER Role Required ───────────────────────
  if (classification === 'admin') {
    // Bypass for E2E tests
    const testBypass =
      request.cookies.get('__test_bypass')?.value === 'true' ||
      request.headers.get('x-playwright-test') === 'true';
    if (testBypass) {
      const response = NextResponse.next();
      addSecurityHeaders(response);
      response.headers.set('x-test-mode', 'true');
      return response;
    }

    const token = request.cookies.get('ftth_session')?.value;

    if (!token) {
      return redirectToLogin(request);
    }

    const claims = verifyToken(token);
    if (!claims) {
      return redirectToLogin(request);
    }

    // Check minimum role for admin routes
    if (!hasMinimumRole(claims.role, 'ADMIN')) {
      // Insufficient permissions → redirect to dashboard with error
      const dashboardUrl = new URL('/dashboard', request.url);
      dashboardUrl.searchParams.set('error', 'insufficient_permissions');
      const response = NextResponse.redirect(dashboardUrl);
      addSecurityHeaders(response);
      return response;
    }

    // Token valid + sufficient role → allow through
    const response = NextResponse.next();
    addSecurityHeaders(response);
    response.headers.set('x-user-id', claims.userId);
    response.headers.set('x-tenant-id', claims.tenantId);
    response.headers.set('x-user-role', claims.role);
    return response;
  }

  // ── Protected Routes: Auth Check ──────────────────────────────────────────
  if (classification === 'protected') {
    // Bypass for E2E tests
    const testBypass =
      request.cookies.get('__test_bypass')?.value === 'true' ||
      request.headers.get('x-playwright-test') === 'true';
    if (testBypass) {
      const response = NextResponse.next();
      addSecurityHeaders(response);
      response.headers.set('x-test-mode', 'true');
      return response;
    }

    const token = request.cookies.get('ftth_session')?.value;

    if (!token) {
      return redirectToLogin(request);
    }

    const claims = verifyToken(token);
    if (!claims) {
      // Invalid or expired token → clear cookie and redirect
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('redirect', request.nextUrl.pathname);
      const response = NextResponse.redirect(loginUrl);
      response.cookies.set({
        name: 'ftth_session',
        value: '',
        maxAge: 0,
        path: '/',
      });
      addSecurityHeaders(response);
      return response;
    }

    // Token valid → allow through
    const response = NextResponse.next();
    addSecurityHeaders(response);
    // Add user info header for server components
    response.headers.set('x-user-id', claims.userId);
    response.headers.set('x-tenant-id', claims.tenantId);
    response.headers.set('x-user-role', claims.role);
    return response;
  }

  // ── Public Routes: No Auth Required ───────────────────────────────────────
  const response = NextResponse.next();
  addSecurityHeaders(response);
  return response;
}

function redirectToLogin(request: NextRequest): Response {
  const loginUrl = new URL('/login', request.url);
  // Preserve the original URL to redirect back after login
  loginUrl.searchParams.set('redirect', request.nextUrl.pathname);
  return NextResponse.redirect(loginUrl);
}

function addSecurityHeaders(response: NextResponse): void {
  // Prevents browsers from interpreting files as a different MIME type
  response.headers.set('x-content-type-options', 'nosniff');
  // Prevents the page from being displayed in an iframe
  response.headers.set('x-frame-options', 'DENY');
  // Legacy XSS filter (still useful for older browsers)
  response.headers.set('x-xss-protection', '1; mode=block');
  // Controls referrer information sent with requests
  response.headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  // Content Security Policy (basic)
  response.headers.set(
    'content-security-policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self' https:;",
  );
  // Prevents MIME type sniffing
  response.headers.set('x-download-options', 'noopen');
  // HSTS for HTTPS environments
  if (process.env['NODE_ENV'] === 'production') {
    response.headers.set(
      'strict-transport-security',
      'max-age=31536000; includeSubDomains',
    );
  }
}
