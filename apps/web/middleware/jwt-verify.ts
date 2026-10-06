/**
 * Lightweight JWT verification for Next.js Edge middleware.
 *
 * Uses `jose`, which is built on Web Crypto, instead of `jsonwebtoken`,
 * which depends on Node's `crypto` module. `crypto.verify` does not exist in
 * the Edge runtime, so jsonwebtoken threw on every call, the catch returned
 * null, and every session was treated as invalid: all protected routes
 * answered 307 to /login while the Node API accepted the same cookie.
 *
 * `jose` is async where jsonwebtoken was synchronous, so `verifyToken` is a
 * promise and the middleware awaits it.
 *
 * Does NOT import `@ftth-copilot/db`: that package bundles Prisma, which
 * pulls in node:fs and cannot run in Edge.
 */

import { jwtVerify } from 'jose';

export interface MiddlewareClaims {
  userId: string;
  tenantId: string;
  role: string;
  mfaVerified?: boolean;
}

/**
 * Read the signing secret.
 *
 * The Edge runtime does not expose arbitrary process.env at request time, so
 * the value is inlined at build time via the `env` block in next.config.mjs
 * and must be passed as a Docker build arg.
 */
function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set');
  return new TextEncoder().encode(secret);
}

/**
 * Verify a JWT and return the claims, or null if invalid/expired.
 * Edge-safe: Web Crypto only, no Prisma, no node:fs.
 */
export async function verifyToken(
  token: string,
): Promise<MiddlewareClaims | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret(), {
      algorithms: ['HS256'],
    });
    if (typeof payload === 'string') return null;

    // The payload uses `sub` for the user id; expose `userId` because that is
    // what the middleware reads when setting the identity headers.
    const claims = payload as unknown as Record<string, unknown>;
    return {
      userId: (claims['sub'] as string) ?? (claims['userId'] as string) ?? '',
      tenantId: (claims['tenantId'] as string) ?? '',
      role: (claims['role'] as string) ?? '',
      ...(claims['mfaVerified'] === undefined
        ? {}
        : { mfaVerified: claims['mfaVerified'] as boolean }),
    };
  } catch {
    return null;
  }
}