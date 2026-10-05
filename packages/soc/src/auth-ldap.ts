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
 *   LDAP_ROLE_MAP      — comma-separated role mappings, default: CN=NOC-Admins:OWNER,CN=NOC-Admins:ADMIN
 */

import type { Client, SearchEntryObject, SearchOptions } from 'ldapjs';

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

  const defaultRoleMap = [
    'CN=NOC-Admins:OWNER',
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

function getAttrValue(entry: SearchEntryObject, attr: string): string | undefined {
  const attrObj = entry.attributes.find((a) => a.type === attr);
  if (!attrObj) return undefined;
  const first = attrObj.values[0];
  return first !== undefined ? String(first) : undefined;
}

/** Extract CN from a full DN string, e.g. "CN=NOC-Admins,OU=Groups,DC=example,DC=com" → "CN=NOC-Admins" */
function extractCn(dn: string): string {
  return dn.split(',')[0] ?? dn;
}

/** Wrap a callback-style LDAP operation in a Promise */
function bindAs(client: Client, dn: string, password: string): Promise<void> {
  return new Promise((resolve, reject) => {
    client.bind(dn, password, (err: Error | null) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function searchUser(
  client: Client,
  base: string,
  filter: string,
  attrs: string[],
): Promise<SearchEntryObject[]> {
  return new Promise((resolve, reject) => {
    const entries: SearchEntryObject[] = [];
    const opts: SearchOptions = {
      scope: 'sub',
      filter,
      attributes: attrs,
      sizeLimit: 1,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client.search(base, opts, (err: any, res: any) => {
      if (err) { reject(err); return; }
      res.on('searchEntry', (entry: { pojo: SearchEntryObject }) => { entries.push(entry.pojo); });
      res.on('error', reject);
      res.on('end', () => resolve(entries));
    });
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

  const { createClient } = await import('ldapjs');
  const client = createClient({
    url: config.url,
    timeout: 5000,
    connectTimeout: 5000,
  });

  try {
    // Step 1: Bind as service account
    await bindAs(client, config.bindDn, config.bindPassword);

    // Step 2: Search for user
    const filter = config.userFilter.replace(/\{username\}/g, username);
    const entries = await searchUser(
      client,
      config.searchBase,
      `(&${filter}(objectClass=*))`,
      [config.emailAttr, config.nameAttr, config.groupAttr],
    );

    if (entries.length === 0) {
      client.unbind();
      return { ok: false, error: 'Usuario no encontrado en LDAP' };
    }

    const entry = entries[0];
    const userDn = entry.objectName ?? '';

    // Step 3: Verify password by binding as the user
    try {
      await bindAs(client, userDn, password);
    } catch {
      client.unbind();
      return { ok: false, error: 'Credenciales LDAP inválidas' };
    }

    // Step 4: Extract attributes
    const email = getAttrValue(entry, config.emailAttr) ?? '';
    const name = getAttrValue(entry, config.nameAttr) ?? username;
    const groupAttr = entry.attributes.find((a) => a.type === config.groupAttr);
    const groups = groupAttr?.values.map(String).map(extractCn) ?? [];

    client.unbind();

    // Step 5: Map groups to role
    const role = deriveRole(groups, config.roleMap);

    if (!email) {
      return { ok: false, error: 'El usuario LDAP no tiene atributo de email configurado' };
    }

    return { ok: true, user: { dn: userDn, email, name, groups, role } };
  } catch (err) {
    try { client.unbind(); } catch { /* ignore */ }
    const message = err instanceof Error ? err.message : 'Error de conexión LDAP';
    return { ok: false, error: message };
  }
}

/** Diagnostic check — verifies LDAP config and connectivity without authenticating. */
export async function diagnoseLdap(): Promise<{ ok: boolean; error?: string; details?: string }> {
  const config = loadConfig();

  if (!config.enabled) {
    return { ok: false, error: 'LDAP is not enabled (LDAP_ENABLED != true)' };
  }

  try {
    const { createClient } = await import('ldapjs');
    const client = createClient({
      url: config.url,
      timeout: 5000,
      connectTimeout: 5000,
    });

    await bindAs(client, config.bindDn, config.bindPassword);
    client.unbind();

    return {
      ok: true,
      details: `Connected to ${config.url} as ${config.bindDn} | Search base: ${config.searchBase}`,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Connection failed',
    };
  }
}
