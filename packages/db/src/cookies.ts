/**
 * Cookie helpers for session management.
 * JWT is sent as an httpOnly cookie scoped to the entire app.
 */
import type { SerializeOptions } from 'cookie';
import { COOKIE_NAME } from './auth';

const ONE_WEEK_SECONDS = 60 * 60 * 24 * 7;

function resolveSecureCookie(): boolean {
  const override = process.env['SESSION_COOKIE_SECURE']?.trim().toLowerCase();
  if (override === 'true') return true;
  if (override === 'false') return false;
  return process.env['NODE_ENV'] === 'production';
}

const baseCookieOptions: SerializeOptions = {
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
  secure: resolveSecureCookie(),
  maxAge: ONE_WEEK_SECONDS,
};

export function sessionCookieAttributes(): SerializeOptions {
  return baseCookieOptions;
}

export { COOKIE_NAME };
