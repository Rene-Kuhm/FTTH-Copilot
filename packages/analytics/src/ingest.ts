import { prisma } from '@ftth-copilot/db';
import type { MetricPoint } from './types';

function toRow(p: MetricPoint) {
  return {
    tenantId: p.tenantId,
    connectionId: p.connectionId,
    deviceKind: p.deviceKind,
    deviceId: p.deviceId,
    kind: p.kind,
    value: p.value ?? null,
    valueText: p.valueText ?? null,
    sampledAt: new Date(p.sampledAt),
  };
}

/**
 * Persists collected metric points in a single batch. Returns the number of
 * inserted rows. An empty batch is a no-op (does not touch the database).
 */
export async function persistSamples(points: MetricPoint[]): Promise<{ inserted: number }> {
  if (points.length === 0) return { inserted: 0 };
  const result = await prisma.metricSample.createMany({ data: points.map(toRow) });
  return { inserted: result.count };
}

/**
 * Deletes samples strictly older than the given cutoff. When `tenantId` is
 * provided the delete is scoped to that tenant so one tenant's retention cycle
 * never purges another tenant's historical data.
 */
export async function deleteSamplesBefore(
  cutoff: Date,
  tenantId?: string,
): Promise<{ deleted: number }> {
  const result = await prisma.metricSample.deleteMany({
    where: {
      ...(tenantId ? { tenantId } : {}),
      sampledAt: { lt: cutoff },
    },
  });
  return { deleted: result.count };
}
