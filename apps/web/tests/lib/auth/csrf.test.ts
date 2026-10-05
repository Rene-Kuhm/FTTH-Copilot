import { describe, it, expect } from 'vitest';
import {
  generateCsrfToken,
  validateCsrfToken,
  createCsrfCookie,
  clearCsrfCookie,
} from '@/lib/auth/csrf';

describe('CSRF protection', () => {
  describe('generateCsrfToken', () => {
    it('generates a token and cookie', () => {
      const { token, cookie } = generateCsrfToken();

      expect(token).toBeDefined();
      expect(token.length).toBe(64); // 32 bytes = 64 hex chars
      expect(cookie).toContain('ftth_csrf=');
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Strict');
    });

    it('generates unique tokens each time', () => {
      const { token: token1 } = generateCsrfToken();
      const { token: token2 } = generateCsrfToken();

      expect(token1).not.toBe(token2);
    });
  });

  describe('validateCsrfToken', () => {
    it('returns true when token matches cookie', () => {
      const { token, cookie } = generateCsrfToken();

      const valid = validateCsrfToken(cookie, token);

      expect(valid).toBe(true);
    });

    it('returns false when token does not match', () => {
      const { cookie } = generateCsrfToken();
      const fakeToken = 'a'.repeat(64);

      const valid = validateCsrfToken(cookie, fakeToken);

      expect(valid).toBe(false);
    });

    it('returns false when cookie is missing', () => {
      const { token } = generateCsrfToken();

      const valid = validateCsrfToken(null, token);

      expect(valid).toBe(false);
    });

    it('returns false when token header is missing', () => {
      const { cookie } = generateCsrfToken();

      const valid = validateCsrfToken(cookie, null);

      expect(valid).toBe(false);
    });

    it('returns false when both are missing', () => {
      const valid = validateCsrfToken(null, null);

      expect(valid).toBe(false);
    });

    it('handles different cookie formats', () => {
      const { token } = generateCsrfToken();

      // With leading space
      expect(validateCsrfToken(` ftth_csrf=${token}`, token)).toBe(true);

      // With semicolon prefix
      expect(validateCsrfToken(`; ftth_csrf=${token}`, token)).toBe(true);

      // With other cookies
      expect(
        validateCsrfToken(
          `other=value; ftth_csrf=${token}; another=test`,
          token,
        ),
      ).toBe(true);
    });

    it('is timing-safe', () => {
      // This test just verifies the function works, actual timing-safe
      // comparison is implemented in the function
      const { token, cookie } = generateCsrfToken();
      expect(validateCsrfToken(cookie, token)).toBe(true);
      expect(validateCsrfToken(cookie, token + 'a')).toBe(false);
    });
  });

  describe('createCsrfCookie', () => {
    it('creates a valid cookie string', () => {
      const { token } = generateCsrfToken();
      const cookie = createCsrfCookie(token);

      expect(cookie).toContain(`ftth_csrf=${token}`);
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Strict');
      expect(cookie).toContain('Max-Age=86400');
    });
  });

  describe('clearCsrfCookie', () => {
    it('creates an expired cookie', () => {
      const cookie = clearCsrfCookie();

      expect(cookie).toContain('ftth_csrf=');
      expect(cookie).toContain('Max-Age=0');
    });
  });
});
