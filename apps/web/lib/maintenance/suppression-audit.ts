/**
 * Maintenance Suppression Audit Log (Roadmap Fase 5 — 5.4 + Gate 5).
 *
 * 5.4: "Registrar cada supresión y su motivo."
 * Gate 5: "quedan auditados avisos suprimidos y reactivados."
 *
 * Persists suppression records to AgentActionLog under
 * `toolName: '__maintenance_suppression__'`.
 */

export const MAINTENANCE_SUPPRESSION_TOOL_NAME = '__maintenance_suppression__' as const;

export interface RecordSuppressionInput {
  tenantId: string;
  windowId: string;
  eventId?: string;
  category: string;
  deviceKind: string;
  deviceId: string;
  whenMs: number;
  reason: string;
  userId?: string;
}

export interface ListSuppressedEventsInput {
  tenantId: string;
  windowId: string;
  limit?: number;
}

export interface SuppressedEventAuditRecord {
  id: string;
  windowId: string;
  eventId?: string;
  category: string;
  deviceKind: string;
  deviceId: string;
  whenMs: number;
  reason: string;
  createdAt: string;
}

interface PrismaLike {
  agentActionLog: {
    create: (args: any) => Promise<any>;
    findMany: (args: any) => Promise<any[]>;
  };
}

/**
 * Records an event suppression into the audit log.
 */
export async function recordSuppressionAudit(
  prisma: PrismaLike,
  input: RecordSuppressionInput,
): Promise<{ id: string }> {
  return prisma.agentActionLog.create({
    data: {
      tenantId: input.tenantId,
      toolName: MAINTENANCE_SUPPRESSION_TOOL_NAME,
      userId: input.userId,
      parameters: {
        windowId: input.windowId,
        eventId: input.eventId,
        category: input.category,
        deviceKind: input.deviceKind,
        deviceId: input.deviceId,
        whenMs: input.whenMs,
        reason: input.reason,
      },
      durationMs: 0,
    },
  });
}

/**
 * Lists suppressed events recorded for a specific window, scoped by tenant.
 */
export async function listSuppressedEvents(
  prisma: PrismaLike,
  input: ListSuppressedEventsInput,
): Promise<SuppressedEventAuditRecord[]> {
  const rows = await prisma.agentActionLog.findMany({
    where: {
      tenantId: input.tenantId,
      toolName: MAINTENANCE_SUPPRESSION_TOOL_NAME,
      parameters: { path: ['windowId'], equals: input.windowId },
    },
    orderBy: { createdAt: 'desc' },
    take: input.limit ?? 50,
  });

  return rows.map((row) => {
    const params = (typeof row.parameters === 'object' && row.parameters !== null
      ? row.parameters
      : {}) as Record<string, any>;

    return {
      id: row.id,
      windowId: String(params.windowId ?? input.windowId),
      eventId: params.eventId ? String(params.eventId) : undefined,
      category: String(params.category ?? 'unknown'),
      deviceKind: String(params.deviceKind ?? 'unknown'),
      deviceId: String(params.deviceId ?? 'unknown'),
      whenMs: Number(params.whenMs ?? 0),
      reason: String(params.reason ?? ''),
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    };
  });
}
