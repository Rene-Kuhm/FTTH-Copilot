/**
 * @ftth-copilot/db — Database access layer + auth utilities.
 *
 * Re-exports the Prisma client (with singleton) and the auth/crypto helpers.
 * The auth utilities are in this package so other workspaces can import them
 * without creating a separate @ftth-copilot/auth package.
 */
export { prisma } from './client';

// Re-export Prisma models and enums for convenience.
export * from './generated/client/index.js';
export { Prisma } from './generated/client/index.js';

// Auth utilities (also part of this package — kept colocated for ergonomics).
export {
  hashPassword,
  verifyPassword,
  issueToken,
  verifyToken,
  hashToken,
  COOKIE_NAME,
  TOKEN_TTL_SECONDS,
  type SessionClaims,
} from './auth';
export { sessionCookieAttributes } from './cookies';
export { encryptApiKey, decryptApiKey } from './crypto';
export {
  checkAuthQuota,
  recordAuthAttempt,
  computeWindowStart,
  extractClientIp,
  authRateLimitKeys,
  type AuthQuotaOptions,
  type AuthRateLimitStore,
} from './auth-rate-limit';
