/**
 * CSRF Protection utilities.
 *
 * Implements double-submit cookie pattern:
 * 1. CSRF token generated on login, stored in cookie
 * 2. Client reads token and sends in X-CSRF-Token header
 * 3. Server validates token matches cookie
 *
 * This is a simplified approach that doesn't require server-side storage.
 *
 * SECURITY: the CSRF cookie is deliberately NOT `HttpOnly`.
 *
 * In this pattern the token is not a credential: the protection comes from an
 * attacker cross-site being unable to read the victim's cookie or set a custom
 * request header. Marking it `HttpOnly` makes the client unable to complete the
 * handshake and locks out legitimate traffic, so the defence can only fail
 * closed. `HttpOnly` belongs on the session cookie (`ftth_session`), which is a
 * real credential and does set it.
 */

const CSRF_COOKIE_NAME = 'ftth_csrf';
const CSRF_TOKEN_LENGTH = 32; // 256 bits of entropy

/**
 * Generate `byteLength` random bytes as a lowercase hex string.
 *
 * Uses Web Crypto (`globalThis.crypto`) instead of `node:crypto` so this
 * module stays importable from the Edge runtime, where `node:crypto` is not
 * available. The middleware imports `validateCsrfToken` from here, and a
 * module-level `node:crypto` import breaks the Edge bundle at build time.
 */
function randomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  globalThis.crypto.getRandomValues(bytes);
  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Generate a new CSRF token.
 * Returns { token, cookie } where cookie is the Set-Cookie header value.
 */
export function generateCsrfToken(): { token: string; cookie: string } {
  const token = randomHex(CSRF_TOKEN_LENGTH);
  return { token, cookie: createCsrfCookie(token) };
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
 *
 * Intentionally omits `HttpOnly` so the browser can read it and echo the value
 * in `X-CSRF-Token`. See the module header for the reasoning.
 */
export function createCsrfCookie(token: string): string {
  return `${CSRF_COOKIE_NAME}=${token}; Path=/; SameSite=Strict; Max-Age=86400`;
}

/**
 * Create an expired CSRF cookie (for logout).
 *
 * The attribute set must match `createCsrfCookie` so the browser replaces the
 * original cookie instead of storing a second one under a different shape.
 */
export function clearCsrfCookie(): string {
  return `${CSRF_COOKIE_NAME}=; Path=/; SameSite=Strict; Max-Age=0`;
}

export { CSRF_COOKIE_NAME };
