/**
 * Browser-side CSRF support for the double-submit pattern.
 *
 * The middleware rejects any mutation whose `X-CSRF-Token` header does not
 * match the `ftth_csrf` cookie, so every client mutation must go through
 * {@link csrfFetch} rather than calling `fetch` directly.
 *
 * The cookie is intentionally readable by script (see the reasoning in
 * `csrf.ts`); the session cookie remains `HttpOnly` and is never touched here.
 */

const CSRF_COOKIE_NAME = 'ftth_csrf';
const CSRF_HEADER_NAME = 'X-CSRF-Token';

/** Methods the middleware treats as state-changing. */
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Read the CSRF token from `document.cookie`.
 *
 * Returns null outside the browser or when the cookie is absent, e.g. before
 * login completes.
 */
export function getCsrfToken(): string | null {
  if (typeof document === 'undefined') return null;

  // Match `name=value` on a `;` boundary, tolerating the space browsers add.
  const match = document.cookie.match(
    new RegExp(`(?:^|;\\s*)${CSRF_COOKIE_NAME}=([^;]*)`),
  );
  return match?.[1] || null;
}

/**
 * `fetch` that attaches the CSRF header on state-changing requests.
 *
 * Throws instead of issuing a request the middleware would reject with an
 * opaque 403, so a missing token points at its cause.
 */
export async function csrfFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase();

  if (!UNSAFE_METHODS.has(method)) {
    return fetch(input, init);
  }

  const token = getCsrfToken();
  if (!token) {
    throw new Error(
      `CSRF token missing: cannot send ${method} without the ` +
        `${CSRF_COOKIE_NAME} cookie. Sign in again, or check that the ` +
        'response sets it.',
    );
  }

  return fetch(input, {
    ...init,
    credentials: init.credentials ?? 'include',
    headers: {
      ...init.headers,
      [CSRF_HEADER_NAME]: token,
    },
  });
}

export { CSRF_COOKIE_NAME, CSRF_HEADER_NAME };