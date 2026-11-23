import { beforeAll, describe, expect, it, vi } from 'vitest';

beforeAll(() => {
  process.env['JWT_SECRET'] = 'test-jwt-secret-with-more-than-thirty-two-bytes';
  process.env['KMS_MASTER_KEY'] = 'test-kms-secret-different-and-thirty-two-bytes';
});

import {
  hashPassword,
  hashToken,
  issueToken,
  verifyPassword,
  verifyToken,
} from '../src/auth';
import { decryptApiKey, encryptApiKey } from '../src/crypto';
import { sessionCookieAttributes } from '../src/cookies';

describe('auth utilities', () => {
  // bcrypt cost 12 is intentionally slow (~5s); give it headroom so it does
  // not flake on slow CI runners under the default 5s test timeout.
  it('hashes and verifies passwords', async () => {
    const hash = await hashPassword('correct-horse-battery-staple');
    await expect(verifyPassword('correct-horse-battery-staple', hash)).resolves.toBe(true);
    await expect(verifyPassword('wrong-password', hash)).resolves.toBe(false);
  }, 30_000);

  it('issues, verifies and hashes session tokens', () => {
    const issued = issueToken('user-1', 'tenant-1', 'OWNER');
    expect(issued.tokenHash).toBe(hashToken(issued.token));
    expect(issued.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(verifyToken(issued.token)).toMatchObject({ sub: 'user-1', tenantId: 'tenant-1' });
    expect(verifyToken(`${issued.token}tampered`)).toBeNull();
  });
});

describe('token uniqueness', () => {
  it('issues distinct tokens and hashes for the same user within the same second', () => {
    // Session.tokenHash is unique: two logins (or a temp token and a session
    // token) in the same second must not produce the same JWT.
    const now = new Date('2026-01-01T00:00:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      const first = issueToken('user-1', 'tenant-1', 'OWNER');
      const second = issueToken('user-1', 'tenant-1', 'OWNER');
      expect(second.token).not.toBe(first.token);
      expect(second.tokenHash).not.toBe(first.tokenHash);
      expect(verifyToken(first.token)).toMatchObject({ sub: 'user-1', tenantId: 'tenant-1' });
      expect(verifyToken(second.token)).toMatchObject({ sub: 'user-1', tenantId: 'tenant-1' });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('credential encryption', () => {
  it('round-trips an API key with authenticated encryption', () => {
    const encrypted = encryptApiKey('nms-secret');
    expect(encrypted.encryptedKey).not.toContain('nms-secret');
    expect(decryptApiKey(encrypted.encryptedKey)).toBe('nms-secret');
  });

  it('rejects malformed or tampered ciphertext', () => {
    expect(() => decryptApiKey('bad')).toThrow('Invalid encrypted blob');
    const encrypted = encryptApiKey('nms-secret');
    const blob = Buffer.from(encrypted.encryptedKey, 'base64');
    blob[15] = (blob[15] ?? 0) ^ 1;
    expect(() => decryptApiKey(blob.toString('base64'))).toThrow();
  });
});

describe('session cookie', () => {
  it('is HTTP-only, same-site and scoped to the application', () => {
    expect(sessionCookieAttributes()).toMatchObject({
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
    });
  });
});
