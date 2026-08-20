/**
 * Auth lib for FTTH-Copilot.
 *
 * - Password hashing: bcrypt (cost 12).
 * - Session tokens: JWT (signed with HS256). The token is sent to the client
 *   as an httpOnly cookie. The DB stores a SHA-256 hash of the token so a DB
 *   leak doesn't expose live sessions.
 * - Token contents: { sub: userId, tenantId, role, iat, exp }
 *
 * NOTE: The JWT_SECRET is intentionally read from env at runtime. In
 * production set a strong secret (32+ random bytes). Default is a dev-only
 * placeholder so the app boots out of the box.
 */
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { Role } from './generated/client/index';

const BCRYPT_COST = 12;
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days
const COOKIE_NAME = 'ftth_session';

const JWT_SECRET =
  process.env['JWT_SECRET'] ??
  'dev-only-insecure-secret-replace-me-in-production-please-32bytes-min';

export interface SessionClaims {
  sub: string;     // userId
  tenantId: string;
  role: Role;
  iat: number;
  exp: number;
}

// ── Password hashing ──

export async function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, BCRYPT_COST);
}

export async function verifyPassword(plaintext: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plaintext, hash);
}

// ── Session tokens ──

export function issueToken(userId: string, tenantId: string, role: Role): {
  token: string;
  tokenHash: string;
  expiresAt: Date;
} {
  const token = jwt.sign(
    { sub: userId, tenantId, role } as Omit<SessionClaims, 'iat' | 'exp'>,
    JWT_SECRET,
    { algorithm: 'HS256', expiresIn: TOKEN_TTL_SECONDS },
  );
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_SECONDS * 1000);
  return { token, tokenHash, expiresAt };
}

export function verifyToken(token: string): SessionClaims | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    if (typeof decoded === 'string') return null;
    return decoded as unknown as SessionClaims;
  } catch {
    return null;
  }
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export { COOKIE_NAME, TOKEN_TTL_SECONDS };
