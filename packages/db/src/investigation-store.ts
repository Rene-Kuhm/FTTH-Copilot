import {
  investigationResultSchema,
  type InvestigationResult,
} from '@ftth-copilot/shared';
import { prisma as defaultPrisma } from './client';

export interface PersistInvestigationVersionArgs {
  tenantId: string;
  runId: string;
  investigationResult: InvestigationResult;
  connectionId?: string | null;
  incidentId?: string | null;
  requestedByUserId?: string;
}

export interface PersistedInvestigationVersion {
  id: string;
  tenantId: string;
  runId: string;
  versionId: string;
  versionIndex: number;
  rulesetVersion: string;
  promptVersion: string;
  modelVersion: string;
  snapshot: InvestigationResult;
  snapshotAt: Date;
}

// Minimal DB client interface for transaction compatibility
export type DbClient = typeof defaultPrisma;

/**
 * Persists an immutable InvestigationVersion with its snapshotJson bounded
 * and validated according to ftth.investigation-result.v1.
 *
 * Increments versionIndex atomically and transitions run.status to 'ready'.
 * Never mutates existing versions.
 */
export async function persistInvestigationVersion(
  args: PersistInvestigationVersionArgs,
  client: DbClient = defaultPrisma,
): Promise<PersistedInvestigationVersion> {
  // 1. Strict schema validation prior to any database operation
  const validated = investigationResultSchema.parse(args.investigationResult);

  if (validated.tenantId !== args.tenantId) {
    throw new Error(
      `Tenant mismatch: investigationResult has tenant '${validated.tenantId}', arguments have '${args.tenantId}'`,
    );
  }

  // 2. Atomic transaction to determine versionIndex and insert row
  const row = await client.$transaction(async (tx) => {
    let run = await tx.investigationRun.findFirst({
      where: { tenantId: args.tenantId, runId: args.runId },
      select: { id: true, tenantId: true, runId: true },
    });

    if (!run) {
      if (args.requestedByUserId) {
        run = await tx.investigationRun.create({
          data: {
            tenantId: args.tenantId,
            runId: args.runId,
            connectionId: args.connectionId ?? validated.connectionId ?? null,
            incidentId: args.incidentId ?? validated.incidentId ?? null,
            requestedByUserId: args.requestedByUserId,
            status: 'pending',
          },
          select: { id: true, tenantId: true, runId: true },
        });
      } else {
        throw new Error(
          `Investigation run '${args.runId}' not found for tenant '${args.tenantId}'`,
        );
      }
    }

    // Determine latest versionIndex
    const latest = await tx.investigationVersion.findFirst({
      where: { tenantId: args.tenantId, runId: args.runId },
      orderBy: { versionIndex: 'desc' },
      select: { versionIndex: true },
    });

    const nextIndex = latest !== null ? latest.versionIndex + 1 : 0;

    const created = await tx.investigationVersion.create({
      data: {
        tenantId: args.tenantId,
        runRefId: run.id,
        runId: args.runId,
        versionId: validated.versionId,
        versionIndex: nextIndex,
        rulesetVersion: validated.rulesetVersion,
        promptVersion: validated.promptVersion,
        modelVersion: validated.modelVersion,
        snapshotJson: validated as unknown as object,
        snapshotAt: new Date(validated.cutoffAt),
      },
    });

    await tx.investigationRun.update({
      where: { id: run.id },
      data: { status: 'ready' },
    });

    return created;
  });

  return {
    id: row.id,
    tenantId: row.tenantId,
    runId: row.runId,
    versionId: row.versionId,
    versionIndex: row.versionIndex,
    rulesetVersion: row.rulesetVersion,
    promptVersion: row.promptVersion,
    modelVersion: row.modelVersion,
    snapshot: investigationResultSchema.parse(row.snapshotJson),
    snapshotAt: row.snapshotAt,
  };
}

/**
 * Retrieves the latest immutable InvestigationVersion snapshot for a run.
 */
export async function getLatestInvestigationVersion(
  args: { tenantId: string; runId: string },
  client: DbClient = defaultPrisma,
): Promise<PersistedInvestigationVersion | null> {
  const row = await client.investigationVersion.findFirst({
    where: { tenantId: args.tenantId, runId: args.runId },
    orderBy: { versionIndex: 'desc' },
  });

  if (!row) return null;

  return {
    id: row.id,
    tenantId: row.tenantId,
    runId: row.runId,
    versionId: row.versionId,
    versionIndex: row.versionIndex,
    rulesetVersion: row.rulesetVersion,
    promptVersion: row.promptVersion,
    modelVersion: row.modelVersion,
    snapshot: investigationResultSchema.parse(row.snapshotJson),
    snapshotAt: row.snapshotAt,
  };
}

/**
 * Retrieves a specific historical InvestigationVersion snapshot by versionId.
 * Guarantees that what the technician evaluated remains auditable.
 */
export async function getInvestigationVersionById(
  args: { tenantId: string; runId: string; versionId: string },
  client: DbClient = defaultPrisma,
): Promise<PersistedInvestigationVersion | null> {
  const row = await client.investigationVersion.findFirst({
    where: {
      tenantId: args.tenantId,
      runId: args.runId,
      versionId: args.versionId,
    },
  });

  if (!row) return null;

  return {
    id: row.id,
    tenantId: row.tenantId,
    runId: row.runId,
    versionId: row.versionId,
    versionIndex: row.versionIndex,
    rulesetVersion: row.rulesetVersion,
    promptVersion: row.promptVersion,
    modelVersion: row.modelVersion,
    snapshot: investigationResultSchema.parse(row.snapshotJson),
    snapshotAt: row.snapshotAt,
  };
}

/**
 * Lists all immutable investigation versions for a run, ordered by versionIndex ascending.
 */
export async function listInvestigationVersions(
  args: { tenantId: string; runId: string },
  client: DbClient = defaultPrisma,
): Promise<PersistedInvestigationVersion[]> {
  const rows = await client.investigationVersion.findMany({
    where: { tenantId: args.tenantId, runId: args.runId },
    orderBy: { versionIndex: 'asc' },
  });

  return rows.map((row) => ({
    id: row.id,
    tenantId: row.tenantId,
    runId: row.runId,
    versionId: row.versionId,
    versionIndex: row.versionIndex,
    rulesetVersion: row.rulesetVersion,
    promptVersion: row.promptVersion,
    modelVersion: row.modelVersion,
    snapshot: investigationResultSchema.parse(row.snapshotJson),
    snapshotAt: row.snapshotAt,
  }));
}
