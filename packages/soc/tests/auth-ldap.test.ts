import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock ldapjs before importing the module under test
vi.mock('ldapjs', () => ({
  createClient: vi.fn(() => ({
    bind: vi.fn((_dn: string, _pw: string, cb: (err: Error | null) => void) => cb(null)),
    search: vi.fn(() => ({
      on: vi.fn(),
    })),
    unbind: vi.fn(),
  })),
}));

describe('authenticateLdapUser', () => {
  beforeEach(() => {
    process.env.LDAP_ENABLED = 'false';
    vi.clearAllMocks();
  });

  it('returns error when LDAP is not enabled', async () => {
    process.env.LDAP_ENABLED = 'false';
    const { authenticateLdapUser } = await import('../src/auth-ldap');
    const result = await authenticateLdapUser('testuser', 'testpass');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('LDAP authentication is not enabled');
  });

  it('returns error when LDAP enabled but BIND_DN is missing', async () => {
    process.env.LDAP_ENABLED = 'true';
    process.env.LDAP_BIND_DN = '';
    process.env.LDAP_SEARCH_BASE = 'ou=users,dc=example,dc=com';
    const { authenticateLdapUser } = await import('../src/auth-ldap');
    const result = await authenticateLdapUser('testuser', 'testpass');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('not configured');
  });

  it('returns error when LDAP enabled but SEARCH_BASE is missing', async () => {
    process.env.LDAP_ENABLED = 'true';
    process.env.LDAP_BIND_DN = 'cn=admin,dc=example,dc=com';
    process.env.LDAP_BIND_PASSWORD = 'secret';
    process.env.LDAP_SEARCH_BASE = '';
    const { authenticateLdapUser } = await import('../src/auth-ldap');
    const result = await authenticateLdapUser('testuser', 'testpass');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('not configured');
  });
});

describe('diagnoseLdap', () => {
  beforeEach(() => {
    process.env.LDAP_ENABLED = 'false';
    vi.clearAllMocks();
  });

  it('returns error when LDAP_ENABLED is not set', async () => {
    process.env.LDAP_ENABLED = 'false';
    const { diagnoseLdap } = await import('../src/auth-ldap');
    const result = await diagnoseLdap();
    expect(result.ok).toBe(false);
    expect(result.error).toContain('not enabled');
  });
});
