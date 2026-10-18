import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the ldapts client before importing the module under test.
const ldap = vi.hoisted(() => {
  const bind = vi.fn(async (_dn: string, _password?: string): Promise<void> => {});
  const search = vi.fn(async (_base: string, _options?: unknown) => ({
    searchEntries: [] as Array<Record<string, unknown>>,
    searchReferences: [] as string[],
  }));
  const unbind = vi.fn(async (): Promise<void> => {});
  const constructed = vi.fn((_options: Record<string, unknown>): void => {});
  return { bind, search, unbind, constructed };
});

// Only the client is mocked: filter escaping comes from the real library, so the
// escape test exercises ldapts's own RFC 4515 implementation.
vi.mock('ldapts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ldapts')>();

  class Client {
    public bind = ldap.bind;
    public search = ldap.search;
    public unbind = ldap.unbind;

    public constructor(options: Record<string, unknown>) {
      ldap.constructed(options);
    }
  }

  return { ...actual, Client };
});

const LDAP_ENV_KEYS = [
  'LDAP_ENABLED',
  'LDAP_URL',
  'LDAP_BIND_DN',
  'LDAP_BIND_PASSWORD',
  'LDAP_SEARCH_BASE',
  'LDAP_USER_FILTER',
  'LDAP_EMAIL_ATTR',
  'LDAP_NAME_ATTR',
  'LDAP_GROUP_ATTR',
  'LDAP_ROLE_MAP',
];

function resetLdapEnv(): void {
  for (const key of LDAP_ENV_KEYS) {
    delete process.env[key];
  }
  process.env.LDAP_ENABLED = 'false';
}

function enableLdap(): void {
  process.env.LDAP_ENABLED = 'true';
  process.env.LDAP_URL = 'ldap://ldap.test:389';
  process.env.LDAP_BIND_DN = 'cn=svc,dc=example,dc=com';
  process.env.LDAP_BIND_PASSWORD = 'secret';
  process.env.LDAP_SEARCH_BASE = 'ou=users,dc=example,dc=com';
}

beforeEach(() => {
  resetLdapEnv();
  vi.resetAllMocks();
  ldap.bind.mockResolvedValue(undefined);
  ldap.search.mockResolvedValue({ searchEntries: [], searchReferences: [] });
  ldap.unbind.mockResolvedValue(undefined);
});

describe('authenticateLdapUser', () => {
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

  it('authenticates a user, extracting attributes and mapping groups to the highest role', async () => {
    enableLdap();
    ldap.search.mockResolvedValue({
      searchEntries: [
        {
          dn: 'CN=Test User,OU=Users,DC=example,DC=com',
          mail: 'test.user@example.com',
          cn: 'Test User',
          memberOf: [
            'CN=NOC-Ops,OU=Groups,DC=example,DC=com',
            'CN=NOC-Admins,OU=Groups,DC=example,DC=com',
          ],
        },
      ],
      searchReferences: [],
    });

    const { authenticateLdapUser } = await import('../src/auth-ldap');
    const result = await authenticateLdapUser('testuser', 'testpass');

    expect(result).toEqual({
      ok: true,
      user: {
        dn: 'CN=Test User,OU=Users,DC=example,DC=com',
        email: 'test.user@example.com',
        name: 'Test User',
        groups: ['CN=NOC-Ops', 'CN=NOC-Admins'],
        role: 'ADMIN',
      },
    });
    expect(ldap.constructed).toHaveBeenCalledWith({
      url: 'ldap://ldap.test:389',
      timeout: 5000,
      connectTimeout: 5000,
    });
    expect(ldap.bind).toHaveBeenNthCalledWith(1, 'cn=svc,dc=example,dc=com', 'secret');
    expect(ldap.bind).toHaveBeenNthCalledWith(
      2,
      'CN=Test User,OU=Users,DC=example,DC=com',
      'testpass',
    );
    expect(ldap.search).toHaveBeenCalledWith('ou=users,dc=example,dc=com', {
      scope: 'sub',
      filter: '(&(uid=testuser)(objectClass=*))',
      attributes: ['mail', 'cn', 'memberOf'],
      sizeLimit: 2,
    });
    expect(ldap.unbind).toHaveBeenCalledTimes(1);
  });

  it('reads single-valued attributes regardless of server attribute casing', async () => {
    enableLdap();
    process.env.LDAP_USER_FILTER = '(sAMAccountName={username})';
    ldap.search.mockResolvedValue({
      searchEntries: [
        {
          dn: 'CN=Other User,OU=Users,DC=example,DC=com',
          Mail: 'other.user@example.com',
          CN: 'Other User',
          memberOf: 'CN=NOC-Members,OU=Groups,DC=example,DC=com',
        },
      ],
      searchReferences: [],
    });

    const { authenticateLdapUser } = await import('../src/auth-ldap');
    const result = await authenticateLdapUser('otheruser', 'testpass');

    expect(result.ok).toBe(true);
    expect(result.user).toEqual({
      dn: 'CN=Other User,OU=Users,DC=example,DC=com',
      email: 'other.user@example.com',
      name: 'Other User',
      groups: ['CN=NOC-Members'],
      role: 'MEMBER',
    });
    expect(ldap.search).toHaveBeenCalledWith(
      'ou=users,dc=example,dc=com',
      expect.objectContaining({ filter: '(&(sAMAccountName=otheruser)(objectClass=*))' }),
    );
  });

  it('returns an error and unbinds when the user is not found', async () => {
    enableLdap();

    const { authenticateLdapUser } = await import('../src/auth-ldap');
    const result = await authenticateLdapUser('ghost', 'testpass');

    expect(result).toEqual({ ok: false, error: 'Usuario no encontrado en LDAP' });
    expect(ldap.bind).toHaveBeenCalledTimes(1);
    expect(ldap.unbind).toHaveBeenCalledTimes(1);
  });

  it('returns an error and unbinds when the user password is rejected', async () => {
    enableLdap();
    ldap.search.mockResolvedValue({
      searchEntries: [
        {
          dn: 'CN=Test User,OU=Users,DC=example,DC=com',
          mail: 'test.user@example.com',
          cn: 'Test User',
        },
      ],
      searchReferences: [],
    });
    ldap.bind
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Invalid credentials'));

    const { authenticateLdapUser } = await import('../src/auth-ldap');
    const result = await authenticateLdapUser('testuser', 'wrongpass');

    expect(result).toEqual({ ok: false, error: 'Credenciales LDAP inválidas' });
    expect(ldap.unbind).toHaveBeenCalledTimes(1);
  });

  it('returns an error when the user has no configured email attribute', async () => {
    enableLdap();
    ldap.search.mockResolvedValue({
      searchEntries: [
        { dn: 'CN=No Mail,OU=Users,DC=example,DC=com', cn: 'No Mail' },
      ],
      searchReferences: [],
    });

    const { authenticateLdapUser } = await import('../src/auth-ldap');
    const result = await authenticateLdapUser('nomail', 'testpass');

    expect(result.ok).toBe(false);
    expect(result.error).toBe('El usuario LDAP no tiene atributo de email configurado');
  });

  it('returns the connection error message when binding the service account fails', async () => {
    enableLdap();
    ldap.bind.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));

    const { authenticateLdapUser } = await import('../src/auth-ldap');
    const result = await authenticateLdapUser('testuser', 'testpass');

    expect(result).toEqual({ ok: false, error: 'connect ECONNREFUSED' });
    expect(ldap.search).not.toHaveBeenCalled();
  });

  it('surfaces the nested failure when the client throws an AggregateError', async () => {
    enableLdap();
    // ldapts raises AggregateError (empty message) when several resolved
    // addresses fail to connect.
    ldap.bind.mockRejectedValueOnce(
      new AggregateError([new Error('connect ECONNREFUSED 127.0.0.1:389')]),
    );

    const { authenticateLdapUser } = await import('../src/auth-ldap');
    const result = await authenticateLdapUser('testuser', 'testpass');

    expect(result).toEqual({ ok: false, error: 'connect ECONNREFUSED 127.0.0.1:389' });
  });

  it('escapes LDAP filter metacharacters in the username', async () => {
    enableLdap();

    const { authenticateLdapUser } = await import('../src/auth-ldap');
    await authenticateLdapUser('a*(b)', 'testpass');

    expect(ldap.search).toHaveBeenCalledWith(
      'ou=users,dc=example,dc=com',
      expect.objectContaining({ filter: '(&(uid=a\\2a\\28b\\29)(objectClass=*))' }),
    );
  });

  it('rejects an empty password without contacting the directory', async () => {
    enableLdap();

    const { authenticateLdapUser } = await import('../src/auth-ldap');
    const result = await authenticateLdapUser('testuser', '');

    // An empty password would be an RFC 4513 unauthenticated bind, which some
    // servers answer with success for any DN.
    expect(result).toEqual({ ok: false, error: 'Credenciales LDAP inválidas' });
    expect(ldap.constructed).not.toHaveBeenCalled();
    expect(ldap.bind).not.toHaveBeenCalled();
  });

  it('never binds an empty DN returned by the directory', async () => {
    enableLdap();
    ldap.search.mockResolvedValue({
      searchEntries: [{ dn: '', mail: 'ghost@example.com', cn: 'Ghost' }],
      searchReferences: [],
    });

    const { authenticateLdapUser } = await import('../src/auth-ldap');
    const result = await authenticateLdapUser('ghost', 'testpass');

    expect(result).toEqual({ ok: false, error: 'Credenciales LDAP inválidas' });
    expect(ldap.bind).toHaveBeenCalledTimes(1);
    expect(ldap.unbind).toHaveBeenCalledTimes(1);
  });

  it('maps the default NOC-Admins group to ADMIN', async () => {
    enableLdap();
    ldap.search.mockResolvedValue({
      searchEntries: [
        {
          dn: 'CN=Admin User,OU=Users,DC=example,DC=com',
          mail: 'admin@example.com',
          cn: 'Admin User',
          memberOf: 'CN=NOC-Admins,OU=Groups,DC=example,DC=com',
        },
      ],
      searchReferences: [],
    });

    const { authenticateLdapUser } = await import('../src/auth-ldap');
    const result = await authenticateLdapUser('adminuser', 'testpass');

    // The default role map must not promise OWNER for a group it maps to ADMIN:
    // a duplicated group key keeps only the last mapping.
    expect(result.user?.role).toBe('ADMIN');
  });

  it('keeps OWNER reachable through an explicit role map', async () => {
    enableLdap();
    process.env.LDAP_ROLE_MAP = 'CN=NOC-Owners:OWNER,CN=NOC-Admins:ADMIN';
    ldap.search.mockResolvedValue({
      searchEntries: [
        {
          dn: 'CN=Owner User,OU=Users,DC=example,DC=com',
          mail: 'owner@example.com',
          cn: 'Owner User',
          memberOf: 'CN=NOC-Owners,OU=Groups,DC=example,DC=com',
        },
      ],
      searchReferences: [],
    });

    const { authenticateLdapUser } = await import('../src/auth-ldap');
    const result = await authenticateLdapUser('owneruser', 'testpass');

    expect(result.user?.role).toBe('OWNER');
  });

  it('fails closed when the user filter matches more than one entry', async () => {
    enableLdap();
    ldap.search.mockResolvedValue({
      searchEntries: [
        { dn: 'CN=First,OU=Users,DC=example,DC=com', mail: 'first@example.com', cn: 'First' },
        { dn: 'CN=Second,OU=Users,DC=example,DC=com', mail: 'second@example.com', cn: 'Second' },
      ],
      searchReferences: [],
    });

    const { authenticateLdapUser } = await import('../src/auth-ldap');
    const result = await authenticateLdapUser('duplicated', 'testpass');

    expect(result).toEqual({ ok: false, error: 'Múltiples usuarios coinciden en LDAP' });
    // Only the service-account bind ran: no ambiguous entry is ever asked to prove a password.
    expect(ldap.bind).toHaveBeenCalledTimes(1);
    expect(ldap.unbind).toHaveBeenCalledTimes(1);
  });

  it('keeps the authentication result when closing the connection fails', async () => {
    enableLdap();
    ldap.unbind.mockRejectedValue(new Error('socket already closed'));

    const { authenticateLdapUser } = await import('../src/auth-ldap');
    const result = await authenticateLdapUser('ghost', 'testpass');

    expect(result).toEqual({ ok: false, error: 'Usuario no encontrado en LDAP' });
    expect(ldap.unbind).toHaveBeenCalledTimes(1);
  });

  it('falls back to the generic connection message for non-Error throws', async () => {
    enableLdap();
    ldap.bind.mockRejectedValueOnce('boom');

    const { authenticateLdapUser } = await import('../src/auth-ldap');
    const result = await authenticateLdapUser('testuser', 'testpass');

    expect(result).toEqual({ ok: false, error: 'Error de conexión LDAP' });
  });
});

describe('diagnoseLdap', () => {
  it('returns error when LDAP_ENABLED is not set', async () => {
    process.env.LDAP_ENABLED = 'false';
    const { diagnoseLdap } = await import('../src/auth-ldap');
    const result = await diagnoseLdap();
    expect(result.ok).toBe(false);
    expect(result.error).toContain('not enabled');
  });

  it('reports connectivity details when the service account binds', async () => {
    enableLdap();
    const { diagnoseLdap } = await import('../src/auth-ldap');
    const result = await diagnoseLdap();

    expect(result).toEqual({
      ok: true,
      details:
        'Connected to ldap://ldap.test:389 as cn=svc,dc=example,dc=com | Search base: ou=users,dc=example,dc=com',
    });
    expect(ldap.bind).toHaveBeenCalledWith('cn=svc,dc=example,dc=com', 'secret');
    expect(ldap.unbind).toHaveBeenCalledTimes(1);
  });

  it('returns the error message when the service account bind fails', async () => {
    enableLdap();
    ldap.bind.mockRejectedValueOnce(new Error('Invalid credentials'));
    const { diagnoseLdap } = await import('../src/auth-ldap');
    const result = await diagnoseLdap();

    expect(result).toEqual({ ok: false, error: 'Invalid credentials' });
  });

  it('surfaces the nested failure when the client throws an AggregateError', async () => {
    enableLdap();
    ldap.bind.mockRejectedValueOnce(
      new AggregateError([new Error('connect ECONNREFUSED ::1:389')]),
    );
    const { diagnoseLdap } = await import('../src/auth-ldap');
    const result = await diagnoseLdap();

    expect(result).toEqual({ ok: false, error: 'connect ECONNREFUSED ::1:389' });
  });
});
