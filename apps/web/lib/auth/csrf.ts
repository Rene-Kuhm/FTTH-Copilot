/**
 * CSRF Protection utilities.
 *
 * Implements double-submit cookie pattern:
 * 1. CSRF token generated on login, stored in cookie
 * 2. Client reads token and sends in X-CSRF-Token header
 * 3. Server validates token matches cookie
 *
 * This is a simplified approach that doesn't require server-side storage.
 */

import { randomBytes } from 'node:crypto';

const CSRF_COOKIE_NAME = 'ftth_csrf';
const CSRF_TOKEN_LENGTH = 32; // 256 bits of entropy

/**
 * Generate a new CSRF token.
 * Returns { token, cookie } where cookie is the Set-Cookie header value.
 */
export function generateCsrfToken(): { token: string; cookie: string } {
  const token = randomBytes(CSRF_TOKEN_LENGTH).toString('hex');
  const cookie = `${CSRF_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict`;
  return { token, cookie };
}

/**
 * Validate a CSRF token from request headers against the cookie.
 * Returns true if valid, false otherwise.
 */
export function validateCsrfToken(
  cookieHeader: string | null,
  tokenHeader: string | null,
): boolean {
  // Both must be present
  if (!cookieHeader || !tokenHeader) {
    return false;
  }

  // Extract token from cookie
  // Handles: 'ftth_csrf=token', ' ftth_csrf=token', '; ftth_csrf=token', ';ftth_csrf=token'
  const csrfCookieMatch = cookieHeader.match(
    new RegExp(`(?:^|[;\\s])${CSRF_COOKIE_NAME}=([^;]+)`),
  );
  if (!csrfCookieMatch) {
    return false;
  }

  const cookieToken = csrfCookieMatch[1];
  const headerToken = tokenHeader;

  // Use constant-time comparison to prevent timing attacks
  if (cookieToken.length !== headerToken.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < cookieToken.length; i++) {
    result |= cookieToken.charCodeAt(i) ^ headerToken.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Get CSRF token from cookie header.
 */
export function getCsrfTokenFromCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;

  const match = cookieHeader.match(
    new RegExp(`(?:^|[;\\s])${CSRF_COOKIE_NAME}=([^;]+)`),
  );
  return match?.[1] ?? null;
}

/**
 * Create the CSRF cookie string for Set-Cookie header.
 */
export function createCsrfCookie(token: string): string {
  return `${CSRF_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`;
}

/**
 * Create an expired CSRF cookie (for logout).
 */
export function clearCsrfCookie(): string {
  return `${CSRF_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}

export { CSRF_COOKIE_NAME };
