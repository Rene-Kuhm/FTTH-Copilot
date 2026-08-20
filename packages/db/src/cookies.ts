/**
 * Cookie helpers for session management.
 * JWT is sent as an httpOnly cookie scoped to the entire app.
 */
import type { SerializeOptions } from 'cookie';
import { COOKIE_NAME } from './auth.js';

const ONE_WEEK_SECONDS = 60 * 60 * 24 * 7;

const baseCookieOptions: SerializeOptions = {
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
  secure: process.env['NODE_ENV'] === 'production',
  maxAge: ONE_WEEK_SECONDS,
};

export function sessionCookieAttributes(): SerializeOptions {
  return baseCookieOptions;
}

export { COOKIE_NAME };
