/**
 * Permission helper — self-contained (no @ftth-copilot/db import).
 * Works on both client and server.
 *
 * Fase D WU5 note: admin promotion of PendingIncidentCandidate →
 * ConfirmedIncident is gated on the OWNER role itself (not on a dedicated
 * permission) because the blast radius is "writes a row the retrieval
 * path surfaces to the LLM as background context". No new permission is
 * added in Phase D; OWNER/ADMIN already have the surface. Add a dedicated
 * `confirm_incident` permission in Fase E if non-admins need to promote.
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
