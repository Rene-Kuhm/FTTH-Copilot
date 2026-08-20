/**
 * @ftth-copilot/db — Database access layer + auth utilities.
 *
 * Re-exports the Prisma client (with singleton) and the auth/crypto helpers.
 * The auth utilities are in this package so other workspaces can import them
 * without creating a separate @ftth-copilot/auth package.
 */
import { PrismaClient } from './generated/client/index.js';

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export const prisma: PrismaClient =
  globalThis.__prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalThis.__prisma = prisma;
}

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
