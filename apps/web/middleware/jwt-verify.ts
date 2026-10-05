/**
 * Lightweight JWT verification for Next.js Edge middleware.
 *
 * Uses only `jsonwebtoken` (pure JS, Edge-compatible) and `process.env`.
 * Does NOT import `@ftth-copilot/db` — that package bundles Prisma which
 * uses `node:fs` and cannot run in Edge runtime.
 */

import jwt from 'jsonwebtoken';

export interface MiddlewareClaims {
  userId: string;
  tenantId: string;
  role: string;
  mfaVerified?: boolean;
}

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set');
  return secret;
}

/**
 * Verify a JWT and return the claims, or null if invalid/expired.
 * Edge-runtime safe: no Prisma, no node:fs.
 */
export function verifyToken(token: string): MiddlewareClaims | null {
  try {
    const decoded = jwt.verify(token, getJwtSecret(), {
      algorithms: ['HS256'],
    });
    if (typeof decoded === 'string') return null;
    return decoded as unknown as MiddlewareClaims;
  } catch {
    return null;
  }
}
