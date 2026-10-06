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
  /**
   * Stable id assigned when the event is received. Makes a retried ingest a
   * no-op instead of a duplicate row.
   */
  ingestId?: string | null;
}

function toRow(input: IngestEventInput) {
  return {
    tenantId: input.tenantId,
    connectionId: input.connectionId ?? null,
    sourceIp: input.sourceIp ?? null,
    facility: input.facility ?? null,
    severity: input.severity ?? null,
    category: input.category,
    message: input.message,
    occurredAt: input.occurredAt ?? new Date(),
    ingestId: input.ingestId ?? null,
  };
}

/**
 * Persists one parsed + classified device event.
 */
export async function ingestEvent(input: IngestEventInput): Promise<void> {
  await prisma.deviceEvent.create({ data: toRow(input) });
}

/**
 * Persists a batch in one round trip.
 *
 * `skipDuplicates` makes this safe to retry: a batch replayed after a crash
 * skips the rows already stored rather than duplicating them. Returns the
 * number of rows actually inserted.
 */
export async function ingestEvents(inputs: IngestEventInput[]): Promise<number> {
  if (inputs.length === 0) return 0;

  const result = await prisma.deviceEvent.createMany({
    data: inputs.map(toRow),
    skipDuplicates: true,
  });

  return result.count;
}
