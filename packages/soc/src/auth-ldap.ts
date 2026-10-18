/**
 * LDAP / Active Directory authentication module.
 *
 * Supports bind authentication against corporate LDAP or AD servers.
 * User attributes (email, name, groups) are read from LDAP search results
 * and mapped to FTTH-Copilot roles.
 *
 * Environment variables:
 *   LDAP_ENABLED        — set to "true" to enable
 *   LDAP_URL           — e.g. ldap://ldap.example.com:389 or ldaps://...
 *   LDAP_BIND_DN       — service account DN, e.g. cn=ftth-ro,ou=service,dc=example,dc=com
 *   LDAP_BIND_PASSWORD — password for service account
 *   LDAP_SEARCH_BASE   — e.g. ou=users,dc=example,dc=com
 *   LDAP_USER_FILTER   — RFC 2254 filter, e.g. (uid={username}) for LDAP or (sAMAccountName={username}) for AD
 *   LDAP_EMAIL_ATTR    — attribute for email, default: mail
 *   LDAP_NAME_ATTR     — attribute for display name, default: cn
 *   LDAP_GROUP_ATTR    — attribute for group membership, default: memberOf
 *   LDAP_ROLE_MAP      — comma-separated role mappings, default: CN=NOC-Admins:ADMIN,CN=NOC-Ops:OPERATOR,CN=NOC-Members:MEMBER
 *                        (a group may appear only once: the last mapping for a group wins,
 *                        so OWNER has to be granted through an explicit LDAP_ROLE_MAP entry)
 */

import type { Client, Entry, SearchOptions } from 'ldapts';

export interface LdapConfig {
  enabled: boolean;
  url: string;
  bindDn: string;
  bindPassword: string;
  searchBase: string;
  userFilter: string;
  emailAttr: string;
  nameAttr: string;
  groupAttr: string;
  roleMap: Map<string, LdapRole>;
}

export type LdapRole = 'OWNER' | 'ADMIN' | 'OPERATOR' | 'MEMBER';

export interface LdapUser {
  dn: string;
  email: string;
  name: string;
  groups: string[];
  role: LdapRole;
}

export interface LdapAuthResult {
  ok: boolean;
  user?: LdapUser;
  error?: string;
}

const ROLE_RANK: Record<LdapRole, number> = {
  OWNER: 3,
  ADMIN: 2,
  OPERATOR: 1,
  MEMBER: 0,
};

function loadConfig(): LdapConfig {
  const enabled = process.env.LDAP_ENABLED === 'true';
  const roleMap = new Map<string, LdapRole>();

  // One mapping per group: the map is keyed by group, so a second entry for the
  // same group would silently discard the first.
  const defaultRoleMap = [
    'CN=NOC-Admins:ADMIN',
    'CN=NOC-Ops:OPERATOR',
    'CN=NOC-Members:MEMBER',
  ];

  const roleMapStr = process.env.LDAP_ROLE_MAP ?? defaultRoleMap.join(',');
  for (const entry of roleMapStr.split(',')) {
    const parts = entry.trim().split(':');
    const group = parts[0]?.trim();
    const role = parts[1]?.trim() as LdapRole | undefined;
    if (group && role && role in ROLE_RANK) {
      roleMap.set(group.toLowerCase(), role);
    }
  }

  return {
    enabled,
    url: process.env.LDAP_URL ?? 'ldap://localhost:389',
    bindDn: process.env.LDAP_BIND_DN ?? '',
    bindPassword: process.env.LDAP_BIND_PASSWORD ?? '',
    searchBase: process.env.LDAP_SEARCH_BASE ?? '',
    userFilter: process.env.LDAP_USER_FILTER ?? '(uid={username})',
    emailAttr: process.env.LDAP_EMAIL_ATTR ?? 'mail',
    nameAttr: process.env.LDAP_NAME_ATTR ?? 'cn',
    groupAttr: process.env.LDAP_GROUP_ATTR ?? 'memberOf',
    roleMap,
  };
}

function deriveRole(groups: string[], roleMap: Map<string, LdapRole>): LdapRole {
  let best: LdapRole = 'MEMBER';
  let bestRank = 0;

  for (const group of groups) {
    const role = roleMap.get(group.toLowerCase());
    if (role && ROLE_RANK[role] > bestRank) {
      best = role;
      bestRank = ROLE_RANK[role];
    }
  }
  return best;
}

/**
 * Read one attribute as a list of string values.
 *
 * ldapts flattens search entries: an attribute holding a single value is a bare
 * `string`, a multi-valued attribute is `string[]`, and an absent attribute has
 * no key at all. Attribute-name casing is whatever the server returned, so a
 * case-insensitive fallback keeps lookups working after the ldapjs migration.
 * Lookups stay on own properties so prototype members (`constructor`) can never
 * be mistaken for directory attributes.
 */
function getAttrValues(entry: Entry, attr: string): string[] {
  let raw: Entry[string] | undefined;
  if (Object.hasOwn(entry, attr)) {
    raw = entry[attr];
  } else {
    const key = Object.getOwnPropertyNames(entry).find(
      (candidate) => candidate.toLowerCase() === attr.toLowerCase(),
    );
    raw = key === undefined ? undefined : entry[key];
  }
  if (raw === undefined) return [];
  const values: Array<Buffer | string> = Array.isArray(raw) ? raw : [raw as Buffer | string];
  return values.map(String);
}

function getAttrValue(entry: Entry, attr: string): string | undefined {
  const first = getAttrValues(entry, attr)[0];
  return first !== undefined ? first : undefined;
}

/** Extract CN from a full DN string, e.g. "CN=NOC-Admins,OU=Groups,DC=example,DC=com" → "CN=NOC-Admins" */
function extractCn(dn: string): string {
  return dn.split(',')[0] ?? dn;
}

/**
 * Turn a thrown LDAP error into a readable message.
 *
 * Node's `net.connect` resolves a hostname to every address and, with
 * autoSelectFamily enabled, rejects a total failure with an `AggregateError`
 * whose own message is empty (e.g. a host with both A and AAAA records). Fall
 * back to the first nested failure before the generic text so callers never see
 * an empty error string.
 */
function describeLdapError(err: unknown, fallback: string): string {
  if (err instanceof Error) {
    if (err.message) return err.message;
    const nested = (err as { errors?: unknown }).errors;
    if (Array.isArray(nested)) {
      for (const candidate of nested) {
        if (candidate instanceof Error && candidate.message) return candidate.message;
      }
    }
    return fallback;
  }
  return fallback;
}

async function searchUser(
  client: Client,
  base: string,
  filter: string,
  attrs: string[],
): Promise<Entry[]> {
  const options: SearchOptions = {
    scope: 'sub',
    filter,
    attributes: attrs,
    // Two entries are enough to tell a unique match from an ambiguous one: the
    // previous client failed the search when the limit was hit, and an ambiguous
    // filter must not silently resolve to whichever entry the server listed first.
    sizeLimit: 2,
  };
  const { searchEntries } = await client.search(base, options);
  return searchEntries;
}

/** Close the connection without letting a close failure replace the caller's result. */
async function closeClient(client: Client): Promise<void> {
  try {
    await client.unbind();
  } catch {
    // The client destroys the socket in a `finally`, so a failed unbind still
    // releases the connection; reporting it would mask the authentication result.
  }
}

/**
 * Load ldapts lazily: the client opens sockets, so it is only imported when a
 * call actually needs LDAP. Dynamic imports are cached by the runtime.
 */
async function loadLdapts(): Promise<typeof import('ldapts')> {
  return import('ldapts');
}

/**
 * Create a client with the module's fixed timeout policy.
 */
async function createClient(url: string): Promise<Client> {
  const { Client: LdapClient } = await loadLdapts();
  return new LdapClient({
    url,
    timeout: 5000,
    connectTimeout: 5000,
  });
}

/**
 * Authenticate a user against LDAP/AD and return their FTTH attributes.
 *
 * Flow:
 * 1. Bind with service account
 * 2. Search for user entry
 * 3. Bind as the user (verify password)
 * 4. Extract email, name, group memberships
 * 5. Map groups to FTTH roles
 */
export async function authenticateLdapUser(
  username: string,
  password: string,
): Promise<LdapAuthResult> {
  const config = loadConfig();

  if (!config.enabled) {
    return { ok: false, error: 'LDAP authentication is not enabled' };
  }

  if (!config.bindDn || !config.searchBase) {
    return { ok: false, error: 'LDAP not configured (missing BIND_DN or SEARCH_BASE)' };
  }

  // An empty password must never reach the directory: LDAP turns it into an
  // RFC 4513 unauthenticated bind, which some servers answer with success.
  if (!password) {
    return { ok: false, error: 'Credenciales LDAP inválidas' };
  }

  const { Filter } = await loadLdapts();
  const client = await createClient(config.url);

  try {
    // Step 1: Bind as service account
    await client.bind(config.bindDn, config.bindPassword);

    // Step 2: Search for user
    const filter = config.userFilter.replace(/\{username\}/g, Filter.escape(username));
    const entries = await searchUser(
      client,
      config.searchBase,
      `(&${filter}(objectClass=*))`,
      [config.emailAttr, config.nameAttr, config.groupAttr],
    );

    if (entries.length === 0) {
      await closeClient(client);
      return { ok: false, error: 'Usuario no encontrado en LDAP' };
    }

    if (entries.length > 1) {
      await closeClient(client);
      return { ok: false, error: 'Múltiples usuarios coinciden en LDAP' };
    }

    const entry = entries[0] as Entry;
    const userDn = entry.dn ?? '';

    // Binding an empty DN is an anonymous bind, which servers accept.
    if (!userDn) {
      await closeClient(client);
      return { ok: false, error: 'Credenciales LDAP inválidas' };
    }

    // Step 3: Verify password by binding as the user
    try {
      await client.bind(userDn, password);
    } catch {
      await closeClient(client);
      return { ok: false, error: 'Credenciales LDAP inválidas' };
    }

    // Step 4: Extract attributes
    const email = getAttrValue(entry, config.emailAttr) ?? '';
    const name = getAttrValue(entry, config.nameAttr) ?? username;
    const groups = getAttrValues(entry, config.groupAttr).map(extractCn);

    await closeClient(client);

    // Step 5: Map groups to role
    const role = deriveRole(groups, config.roleMap);

    if (!email) {
      return { ok: false, error: 'El usuario LDAP no tiene atributo de email configurado' };
    }

    return { ok: true, user: { dn: userDn, email, name, groups, role } };
  } catch (err) {
    await closeClient(client);
    return { ok: false, error: describeLdapError(err, 'Error de conexión LDAP') };
  }
}

/** Diagnostic check — verifies LDAP config and connectivity without authenticating. */
export async function diagnoseLdap(): Promise<{ ok: boolean; error?: string; details?: string }> {
  const config = loadConfig();

  if (!config.enabled) {
    return { ok: false, error: 'LDAP is not enabled (LDAP_ENABLED != true)' };
  }

  let client: Client | undefined;

  try {
    client = await createClient(config.url);

    await client.bind(config.bindDn, config.bindPassword);
    await closeClient(client);

    return {
      ok: true,
      details: `Connected to ${config.url} as ${config.bindDn} | Search base: ${config.searchBase}`,
    };
  } catch (err) {
    if (client) await closeClient(client);
    return {
      ok: false,
      error: describeLdapError(err, 'Connection failed'),
    };
  }
}
