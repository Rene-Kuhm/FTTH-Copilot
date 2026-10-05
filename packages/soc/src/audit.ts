/**
 * Audit logging service.
 *
 * Every mutation that touches security-sensitive resources is recorded here.
 * This is a thin, synchronous wrapper around the Prisma write — callers pass the
 * auth context and the service does the rest, never throwing.
 *
 * Rules:
 *  - metadata must never contain credentials, tokens, passwords, or full API keys
 *  - resourceId is the primary key of the affected row (never the full row)
 *  - system-initiated actions use actorId "system"
 */

import { prisma } from '@ftth-copilot/db';

export interface AuditContext {
  tenantId: string;
  actorId: string;
  actorEmail?: string;
  actorRole?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface AuditEntry {
  category: 'AUTH' | 'USER_MANAGEMENT' | 'INCIDENT' | 'MAINTENANCE' | 'CONNECTOR' | 'NETWORK' | 'NOTIFICATION' | 'CONFIGURATION' | 'AI' | 'SYSTEM';
  action: string;
  resourceType: string;
  resourceId: string;
  outcome: 'SUCCESS' | 'FAILURE';
  metadata?: Record<string, unknown>;
}

/**
 * Log one audit event. Idempotent — errors are swallowed so a failed audit write
 * never rolls back the operation that triggered it.
 *
 * Callers should `await audit(...)` so the write is not lost to fire-and-forget
 * GC, but it is safe to fire-and-forget if the caller needs to preserve the
 * original error-throwing behaviour (e.g. a transaction boundary).
 */
export async function audit(
  ctx: AuditContext,
  entry: AuditEntry,
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        actorEmail: ctx.actorEmail ?? null,
        actorRole: ctx.actorRole ?? null,
        category: entry.category as never,
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId,
        outcome: entry.outcome as never,
        metadata: (entry.metadata ?? {}) as never,
        ipAddress: ctx.ipAddress ?? null,
        userAgent: ctx.userAgent ?? null,
      },
    });
  } catch {
    // Swallow: audit failures must never roll back the triggering operation.
  }
}

/**
 * Convenience wrappers for common audit patterns.
 */
export const auditAuth = {
  login: (ctx: AuditContext, userId: string, ok: boolean, metadata?: Record<string, unknown>) =>
    audit(ctx, {
      category: 'AUTH',
      action: ok ? 'logged in' : 'login failed',
      resourceType: 'User',
      resourceId: userId,
      outcome: ok ? 'SUCCESS' : 'FAILURE',
      metadata,
    }),

  logout: (ctx: AuditContext, userId: string) =>
    audit(ctx, {
      category: 'AUTH',
      action: 'logged out',
      resourceType: 'User',
      resourceId: userId,
      outcome: 'SUCCESS',
    }),

  permissionDenied: (ctx: AuditContext, action: string, resourceType: string, resourceId: string) =>
    audit(ctx, {
      category: 'AUTH',
      action: `permission denied: ${action}`,
      resourceType,
      resourceId,
      outcome: 'FAILURE',
    }),
};

export const auditIncident = {
  created: (ctx: AuditContext, id: string) =>
    audit(ctx, { category: 'INCIDENT', action: 'created incident', resourceType: 'Incident', resourceId: id, outcome: 'SUCCESS' }),

  confirmed: (ctx: AuditContext, id: string) =>
    audit(ctx, { category: 'INCIDENT', action: 'confirmed incident', resourceType: 'Incident', resourceId: id, outcome: 'SUCCESS' }),

  resolved: (ctx: AuditContext, id: string) =>
    audit(ctx, { category: 'INCIDENT', action: 'resolved incident', resourceType: 'Incident', resourceId: id, outcome: 'SUCCESS' }),
};

export const auditConnector = {
  created: (ctx: AuditContext, id: string, provider: string) =>
    audit(ctx, { category: 'CONNECTOR', action: `created ${provider} connector`, resourceType: 'NmsConnection', resourceId: id, outcome: 'SUCCESS' }),

  updated: (ctx: AuditContext, id: string) =>
    audit(ctx, { category: 'CONNECTOR', action: 'updated connector config', resourceType: 'NmsConnection', resourceId: id, outcome: 'SUCCESS' }),

  deleted: (ctx: AuditContext, id: string) =>
    audit(ctx, { category: 'CONNECTOR', action: 'deleted connector', resourceType: 'NmsConnection', resourceId: id, outcome: 'SUCCESS' }),

  tested: (ctx: AuditContext, id: string, ok: boolean) =>
    audit(ctx, { category: 'CONNECTOR', action: 'tested connector', resourceType: 'NmsConnection', resourceId: id, outcome: ok ? 'SUCCESS' : 'FAILURE' }),
};

export const auditNotification = {
  channelCreated: (ctx: AuditContext, id: string, type: string) =>
    audit(ctx, { category: 'NOTIFICATION', action: `created ${type} notification channel`, resourceType: 'NotificationChannel', resourceId: id, outcome: 'SUCCESS' }),

  channelUpdated: (ctx: AuditContext, id: string) =>
    audit(ctx, { category: 'NOTIFICATION', action: 'updated notification channel', resourceType: 'NotificationChannel', resourceId: id, outcome: 'SUCCESS' }),

  channelDeleted: (ctx: AuditContext, id: string) =>
    audit(ctx, { category: 'NOTIFICATION', action: 'deleted notification channel', resourceType: 'NotificationChannel', resourceId: id, outcome: 'SUCCESS' }),

  deliveryFailed: (ctx: AuditContext, channelId: string, error: string) =>
    audit(ctx, { category: 'NOTIFICATION', action: 'notification delivery failed', resourceType: 'NotificationChannel', resourceId: channelId, outcome: 'FAILURE', metadata: { error } }),
};

export const auditMaintenance = {
  created: (ctx: AuditContext, id: string) =>
    audit(ctx, { category: 'MAINTENANCE', action: 'created maintenance window', resourceType: 'MaintenanceWindow', resourceId: id, outcome: 'SUCCESS' }),

  updated: (ctx: AuditContext, id: string) =>
    audit(ctx, { category: 'MAINTENANCE', action: 'updated maintenance window', resourceType: 'MaintenanceWindow', resourceId: id, outcome: 'SUCCESS' }),

  deleted: (ctx: AuditContext, id: string) =>
    audit(ctx, { category: 'MAINTENANCE', action: 'deleted maintenance window', resourceType: 'MaintenanceWindow', resourceId: id, outcome: 'SUCCESS' }),
};

export const auditUser = {
  created: (ctx: AuditContext, id: string) =>
    audit(ctx, { category: 'USER_MANAGEMENT', action: 'created user', resourceType: 'User', resourceId: id, outcome: 'SUCCESS' }),

  roleChanged: (ctx: AuditContext, id: string, oldRole: string, newRole: string) =>
    audit(ctx, { category: 'USER_MANAGEMENT', action: 'changed user role', resourceType: 'User', resourceId: id, outcome: 'SUCCESS', metadata: { oldRole, newRole } }),

  deleted: (ctx: AuditContext, id: string) =>
    audit(ctx, { category: 'USER_MANAGEMENT', action: 'deleted user', resourceType: 'User', resourceId: id, outcome: 'SUCCESS' }),
};
