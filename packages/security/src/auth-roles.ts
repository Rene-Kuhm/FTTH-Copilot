export type RbacRole = 'OWNER' | 'ADMIN' | 'OPERATOR' | 'MEMBER';
export type AppRole = RbacRole;

export const RBAC_ROLE_RANK: Readonly<Record<RbacRole, number>> = {
  OWNER: 3,
  ADMIN: 2,
  OPERATOR: 1,
  MEMBER: 0,
};

export const DEFAULT_ROLE_MAP_ENTRIES: readonly string[] = [
  'CN=NOC-Admins:ADMIN',
  'CN=NOC-Ops:OPERATOR',
  'CN=NOC-Members:MEMBER',
];

function isRbacRole(value: string): value is RbacRole {
  return Object.hasOwn(RBAC_ROLE_RANK, value);
}

/**
 * Parse a comma-separated `group:ROLE` mapping string into a lowercase-keyed Map.
 * Splits on the last `:` so group names or URNs containing colons are preserved.
 * Invalid roles or empty entries are ignored; when a group appears twice, the last entry wins.
 */
export function parseRoleMap(
  roleMapStr?: string,
  defaultEntries: readonly string[] = DEFAULT_ROLE_MAP_ENTRIES,
): Map<string, RbacRole> {
  const roleMap = new Map<string, RbacRole>();
  const source =
    roleMapStr !== undefined && roleMapStr.trim() !== ''
      ? roleMapStr
      : defaultEntries.join(',');

  for (const rawEntry of source.split(',')) {
    const entry = rawEntry.trim();
    if (!entry) continue;
    const sepIdx = entry.lastIndexOf(':');
    if (sepIdx <= 0) continue;
    const group = entry.slice(0, sepIdx).trim();
    const role = entry.slice(sepIdx + 1).trim().toUpperCase();
    if (group && isRbacRole(role)) {
      roleMap.set(group.toLowerCase(), role);
    }
  }

  return roleMap;
}

/**
 * Map a list of directory/IdP group names to the highest-privilege FTTH role.
 * Comparison is case-insensitive. Falls back to `defaultRole` (`MEMBER`)
 * when no group matches.
 */
export function mapGroupsToRole(
  groups: readonly string[],
  roleMap: ReadonlyMap<string, RbacRole>,
  defaultRole: RbacRole = 'MEMBER',
): RbacRole {
  let best: RbacRole = defaultRole;
  let bestRank = RBAC_ROLE_RANK[defaultRole];

  for (const group of groups) {
    const role = roleMap.get(group.trim().toLowerCase());
    if (role && RBAC_ROLE_RANK[role] > bestRank) {
      best = role;
      bestRank = RBAC_ROLE_RANK[role];
    }
  }

  return best;
}
