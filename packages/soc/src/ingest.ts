import { prisma } from '@ftth-copilot/db';
import type { EventCategory } from '@ftth-copilot/security';

export interface IngestEventInput {
  tenantId: string;
  connectionId?: string | null;
  sourceIp?: string | null;
  facility?: number | null;
  severity?: number | null;
  category: EventCategory;
  message: string;
  occurredAt?: Date;
}

/**
 * Persists one parsed + classified device event.
 */
export async function ingestEvent(input: IngestEventInput): Promise<void> {
  await prisma.deviceEvent.create({
    data: {
      tenantId: input.tenantId,
      connectionId: input.connectionId ?? null,
      sourceIp: input.sourceIp ?? null,
      facility: input.facility ?? null,
      severity: input.severity ?? null,
      category: input.category,
      message: input.message,
      occurredAt: input.occurredAt ?? new Date(),
    },
  });
}
