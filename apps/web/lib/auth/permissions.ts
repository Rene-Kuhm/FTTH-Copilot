/**
 * Permission helper — self-contained (no @ftth-copilot/db import).
 * Works on both client and server.
 */

export type Role = 'OWNER' | 'ADMIN' | 'OPERATOR' | 'MEMBER';

export type Permission =
  | 'manage_users'
  | 'manage_connectors'
  | 'view_all_conversations'
  | 'chat'
  | 'view_own_conversations'
  | 'delete_conversations'
  | 'view_network'
  | 'ack_alerts'
  | 'execute_actions';

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  OWNER: [
    'manage_users',
    'manage_connectors',
    'view_all_conversations',
    'chat',
    'view_own_conversations',
    'delete_conversations',
    'view_network',
    'ack_alerts',
    'execute_actions',
  ],
  ADMIN: [
    'manage_users',
    'manage_connectors',
    'view_all_conversations',
    'chat',
    'view_own_conversations',
    'delete_conversations',
    'view_network',
    'ack_alerts',
  ],
  OPERATOR: [
    'chat',
    'view_own_conversations',
    'delete_conversations',
    'view_network',
    'ack_alerts',
  ],
  MEMBER: [
    // Legacy role — treated as OPERATOR
    'chat',
    'view_own_conversations',
    'delete_conversations',
    'view_network',
    'ack_alerts',
  ],
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export function requirePermission(role: Role, permission: Permission): void {
  if (!hasPermission(role, permission)) {
    throw new Error(`Insufficient permissions: requires ${permission}`);
  }
}
