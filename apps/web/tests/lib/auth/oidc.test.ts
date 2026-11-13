import { describe, expect, it } from 'vitest';
import { parseRoleMap } from '@ftth-copilot/security';
import {
  extractGroupsFromClaims,
  isEmailDomainAllowed,
  parseOidcConfig,
  resolveOidcIdentityDecision,
  signOidcTxCookie,
  validateOidcIdTokenClaims,
  verifyOidcTxCookie,
} from '@/lib/auth/oidc';

const VALID_ENV = {
  OIDC_ENABLED: 'true',
  OIDC_ISSUER: 'https://idp.example.com/realms/ftth',
  OIDC_CLIENT_ID: 'ftth-web',
  OIDC_CLIENT_SECRET: 'super-secret',
  OIDC_REDIRECT_URI: 'https://copilot.example.com/api/auth/oidc/callback',
  OIDC_TENANT_SLUG: 'demo-isp',
  OIDC_ALLOWED_EMAIL_DOMAINS: 'example.com, isp.net',
  OIDC_AUTO_PROVISION: 'true',
  OIDC_ROLE_CLAIM: 'groups',
  OIDC_ROLE_MAP: 'noc-admins:ADMIN,noc-ops:OPERATOR',
};

describe('oidc lib', () => {
  describe('parseOidcConfig', () => {
    it('returns { enabled: false } when OIDC_ENABLED is not true', () => {
      expect(parseOidcConfig({})).toEqual({ enabled: false });
      expect(parseOidcConfig({ OIDC_ENABLED: 'false' })).toEqual({ enabled: false });
    });

    it('parses valid OIDC configuration when OIDC_ENABLED=true', () => {
      const cfg = parseOidcConfig(VALID_ENV);
      expect(cfg.enabled).toBe(true);
      if (!cfg.enabled) throw new Error('expected enabled');
      expect(cfg.issuer).toBe('https://idp.example.com/realms/ftth');
      expect(cfg.tenantSlug).toBe('demo-isp');
      expect(cfg.allowedEmailDomains).toEqual(['example.com', 'isp.net']);
      expect(cfg.autoProvision).toBe(true);
      expect(cfg.roleClaim).toBe('groups');
      expect(cfg.roleMap.get('noc-admins')).toBe('ADMIN');
    });

    it('throws a clear Zod error when OIDC_ENABLED=true and required vars are missing', () => {
      expect(() => parseOidcConfig({ OIDC_ENABLED: 'true' })).toThrow(
        /Invalid OIDC configuration when OIDC_ENABLED=true/,
      );
    });

    it('throws when OIDC_ISSUER or OIDC_REDIRECT_URI is not a valid URL', () => {
      expect(() =>
        parseOidcConfig({ ...VALID_ENV, OIDC_ISSUER: 'not-a-url' }),
      ).toThrow(/OIDC_ISSUER/);
      expect(() =>
        parseOidcConfig({ ...VALID_ENV, OIDC_REDIRECT_URI: 'not-a-url' }),
      ).toThrow(/OIDC_REDIRECT_URI/);
    });
  });

  describe('isEmailDomainAllowed', () => {
    it('matches allowed domains case-insensitively', () => {
      expect(isEmailDomainAllowed('alice@Example.COM', ['example.com'])).toBe(true);
    });

    it('rejects unlisted domains, subdomains, and malformed emails', () => {
      expect(isEmailDomainAllowed('alice@evil.com', ['example.com'])).toBe(false);
      expect(isEmailDomainAllowed('alice@sub.example.com', ['example.com'])).toBe(false);
      expect(isEmailDomainAllowed('alice@example.com', [])).toBe(false);
      expect(isEmailDomainAllowed('not-an-email', ['example.com'])).toBe(false);
    });
  });

  describe('extractGroupsFromClaims', () => {
    it('extracts string arrays or single string claims', () => {
      expect(extractGroupsFromClaims({ groups: ['a', 'b'] }, 'groups')).toEqual(['a', 'b']);
      expect(extractGroupsFromClaims({ roles: 'admin' }, 'roles')).toEqual(['admin']);
      expect(extractGroupsFromClaims({}, 'groups')).toEqual([]);
    });
  });

  describe('validateOidcIdTokenClaims', () => {
    const baseExpected = {
      issuer: 'https://idp.example.com/realms/ftth',
      clientId: 'ftth-web',
      nonce: 'nonce-123',
      nowSeconds: 1_700_000_000,
    };
    const validClaims = {
      sub: 'sub-1',
      iss: 'https://idp.example.com/realms/ftth',
      aud: 'ftth-web',
      exp: 1_700_000_600,
      nonce: 'nonce-123',
    };

    it('accepts valid claims (including array aud and trailing slash on iss)', () => {
      expect(validateOidcIdTokenClaims(validClaims, baseExpected)).toEqual({ ok: true });
      expect(
        validateOidcIdTokenClaims(
          { ...validClaims, iss: 'https://idp.example.com/realms/ftth/', aud: ['other', 'ftth-web'] },
          baseExpected,
        ),
      ).toEqual({ ok: true });
    });

    it('rejects issuer, audience, expiry, and nonce mismatches', () => {
      expect(
        validateOidcIdTokenClaims({ ...validClaims, iss: 'https://other.idp' }, baseExpected),
      ).toMatchObject({ ok: false, reason: 'invalid_issuer' });
      expect(
        validateOidcIdTokenClaims({ ...validClaims, aud: 'other-client' }, baseExpected),
      ).toMatchObject({ ok: false, reason: 'invalid_audience' });
      expect(
        validateOidcIdTokenClaims({ ...validClaims, exp: 1_700_000_000 }, baseExpected),
      ).toMatchObject({ ok: false, reason: 'token_expired' });
      expect(
        validateOidcIdTokenClaims({ ...validClaims, nonce: 'wrong-nonce' }, baseExpected),
      ).toMatchObject({ ok: false, reason: 'invalid_nonce' });
    });
  });

  describe('resolveOidcIdentityDecision', () => {
    const roleMap = parseRoleMap('noc-admins:ADMIN,noc-ops:OPERATOR', []);
    const baseInput = {
      existingIdentity: null,
      targetTenantId: 'tenant-1',
      existingUserInTenant: null,
      email: 'alice@example.com',
      emailVerified: true,
      allowedEmailDomains: ['example.com'],
      autoProvision: false,
      groups: ['noc-ops'],
      roleMap,
    };

    it('logs in directly when identity exists in the same tenant', () => {
      expect(
        resolveOidcIdentityDecision({
          ...baseInput,
          existingIdentity: { userId: 'u-1', tenantId: 'tenant-1' },
        }),
      ).toEqual({ action: 'login', userId: 'u-1' });
    });

    it('rejects when identity belongs to a different tenant', () => {
      expect(
        resolveOidcIdentityDecision({
          ...baseInput,
          existingIdentity: { userId: 'u-1', tenantId: 'tenant-other' },
        }),
      ).toMatchObject({ action: 'reject', reason: 'tenant_mismatch' });
    });

    it('rejects when email_verified is false', () => {
      expect(
        resolveOidcIdentityDecision({ ...baseInput, emailVerified: false }),
      ).toMatchObject({ action: 'reject', reason: 'email_not_verified' });
    });

    it('rejects when email domain is not allowed', () => {
      expect(
        resolveOidcIdentityDecision({ ...baseInput, email: 'alice@untrusted.com' }),
      ).toMatchObject({ action: 'reject', reason: 'domain_not_allowed' });
    });

    it('links to existing user in tenant when email is verified and domain is allowed', () => {
      expect(
        resolveOidcIdentityDecision({
          ...baseInput,
          existingUserInTenant: { id: 'u-existing' },
        }),
      ).toEqual({ action: 'link', userId: 'u-existing' });
    });

    it('rejects when no user exists and autoProvision is false', () => {
      expect(
        resolveOidcIdentityDecision({ ...baseInput, autoProvision: false }),
      ).toMatchObject({ action: 'reject', reason: 'user_not_found' });
    });

    it('auto-provisions with highest mapped role when autoProvision is true', () => {
      expect(
        resolveOidcIdentityDecision({
          ...baseInput,
          autoProvision: true,
          groups: ['noc-ops', 'noc-admins'],
        }),
      ).toEqual({ action: 'provision', email: 'alice@example.com', role: 'ADMIN' });
    });

    it('auto-provisions with MEMBER when no group matches', () => {
      expect(
        resolveOidcIdentityDecision({
          ...baseInput,
          autoProvision: true,
          groups: ['unknown-group'],
        }),
      ).toEqual({ action: 'provision', email: 'alice@example.com', role: 'MEMBER' });
    });
  });

  describe('OIDC transaction cookie', () => {
    it('signs and verifies state, nonce, and codeVerifier', async () => {
      const token = await signOidcTxCookie({
        state: 'st-1',
        nonce: 'nn-1',
        codeVerifier: 'cv-1',
      });
      const verified = await verifyOidcTxCookie(token);
      expect(verified).toEqual({ state: 'st-1', nonce: 'nn-1', codeVerifier: 'cv-1' });
      expect(await verifyOidcTxCookie(`${token}tampered`)).toBeNull();
    });
  });
});
