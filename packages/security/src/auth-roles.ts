export type RbacRole = 'OWNER' | 'ADMIN' | 'OPERATOR' | 'MEMBER';

export const RBAC_ROLE_RANK: Record<RbacRole, number> = {
  OWNER: 3,
  ADMIN: 2,
  OPERATOR: 1,
  MEMBER: 0,
};

const DEFAULT_ROLE_MAP_SPEC = 'CN=NOC-Admins:ADMIN,CN=NOC-Ops:OPERATOR,CN=NOC-Members:MEMBER';

/**
 * Parse a comma-separated `group:ROLE` mapping string into a lowercase-keyed Map.
 * Invalid roles or empty entries are ignored; when a group appears twice, the last entry wins.
 */
export function parseRoleMap(roleMapStr?: string): Map<string, RbacRole> {
  const roleMap = new Map<string, RbacRole>();
  const source = roleMapStr !== undefined && roleMapStr.trim() !== '' ? roleMapStr : DEFAULT_ROLE_MAP_SPEC;

  for (const entry of source.split(',')) {
    const colonIdx = entry.indexOf(':');
    if (colonIdx <= 0) continue;
    const group = entry.slice(0, colonIdx).trim();
    const role = entry.slice(colonIdx + 1).trim().toUpperCase() as RbacRole;
    if (group && role in RBAC_ROLE_RANK) {
      roleMap.set(group.toLowerCase(), role);
    }
  }

  return roleMap;
}

/**
 * Map a list of directory/IdP group names to the highest-privilege FTTH role.
 * Falls back to `defaultRole` (MEMBER) when no group matches.
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
