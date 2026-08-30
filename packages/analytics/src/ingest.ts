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
 * Deletes samples strictly older than the given cutoff. Used by retention.
 */
export async function deleteSamplesBefore(cutoff: Date): Promise<{ deleted: number }> {
  const result = await prisma.metricSample.deleteMany({
    where: { sampledAt: { lt: cutoff } },
  });
  return { deleted: result.count };
}
