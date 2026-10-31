import { prisma, persistInvestigationVersion } from '@ftth-copilot/db';
import type { InvestigationResult } from '@ftth-copilot/shared';

/**
 * Cierre de una investigación.
 *
 * Vive acá, y no en la ruta, porque hay **dos** ejecutores posibles de la misma
 * investigación: el proceso web (modo `embedded`) y el worker (modo `worker`).
 * Los dos tienen que cerrar el run igual, y duplicar ese cierre es la forma más
 * fácil de que uno de los dos se olvide de guardar el resultado — que es
 * exactamente el bug que este módulo arregla.
 */

/** Argumentos del cierre exitoso. */
export interface CompleteInvestigationArgs {
  tenantId: string;
  runId: string;
  versionId: string;
  incidentId: string;
  /** Usuario que pidió la investigación. */
  userId: string;
  investigationResult: InvestigationResult;
  /** Cuándo empezó, para registrar la duración real. */
  startedAtMs: number;
}

/** Resultado del cierre exitoso. */
export interface CompleteInvestigationResult {
  versionId: string;
  versionIndex: number;
}

/**
 * Guarda la versión, registra la acción y deja el run en `ready`.
 *
 * Es idempotente por `(tenantId, runId)`: si el resultado llegó tarde y otro
 * ejecutor ya lo guardó, la versión nueva se agrega como otra versión del mismo
 * run en vez de romper.
 */
export async function completeInvestigation(
  args: CompleteInvestigationArgs,
  now: number = Date.now(),
): Promise<CompleteInvestigationResult> {
  const persisted = await persistInvestigationVersion({
    tenantId: args.tenantId,
    runId: args.runId,
    investigationResult: args.investigationResult,
    requestedByUserId: args.userId,
  });

  await prisma.agentActionLog.create({
    data: {
      tenantId: args.tenantId,
      userId: args.userId,
      toolName: '__investigation_open__',
      parameters: {
        incidentId: args.incidentId,
        runId: args.runId,
        versionId: persisted.versionId,
      } as unknown as object,
      result: args.runId,
      durationMs: Math.max(0, now - args.startedAtMs),
    },
  });

  // El run queda en un estado final: sin esto, un run que terminó después del
  // presupuesto HTTP se queda `pending` para siempre y el incidente no se puede
  // volver a investigar.
  // `updatedAt` lo mantiene Prisma; el modelo no tiene `completedAt`, y
  // agregarlo sería una migración por un dato que ya se puede leer de ahí.
  await prisma.investigationRun.updateMany({
    where: { tenantId: args.tenantId, runId: args.runId },
    data: { status: 'ready' },
  });

  return { versionId: persisted.versionId, versionIndex: persisted.versionIndex };
}

/** Argumentos del cierre fallido. */
export interface FailInvestigationArgs {
  tenantId: string;
  runId: string;
  reason: string;
  now?: number;
}

/**
 * Deja el run en `failed`.
 *
 * Un run `failed` no bloquea el botón "investigar": el chequeo de "ya hay uno
 * pendiente" sólo mira `pending`. Sin esto, cualquier error del pipeline
 * dejaba el incidente inutilizable.
 */
export async function failInvestigation(args: FailInvestigationArgs): Promise<void> {
  await prisma.investigationRun.updateMany({
    where: { tenantId: args.tenantId, runId: args.runId },
    // El motivo no se guarda en el run: el modelo no tiene una columna de
    // error y agregarla es una migración. Queda en el log de quien falla.
    data: { status: 'failed' },
  });
}

/** Un run que quedó `pending` más tiempo del permitido. */
export interface ExpireStaleRunsArgs {
  /** Edad a partir de la cual un `pending` se considera abandonado. */
  ttlMs: number;
  /** Momento de referencia. Defaults to now. */
  now?: number;
}

/**
 * Pasa a `expired` los runs que quedaron `pending`.
 *
 * Hace falta aunque el bug esté arreglado: en producción ya puede haber filas
 * trabadas por él, y un proceso que muere a mitad de una investigación deja la
 * fila igual de trabada. `expired` no bloquea el botón, así que el operador
 * puede volver a intentar.
 */
export async function expireStaleRuns(args: ExpireStaleRunsArgs): Promise<number> {
  const now = args.now ?? Date.now();
  const cutoff = new Date(now - args.ttlMs);

  const result = await prisma.investigationRun.updateMany({
    where: { status: 'pending', requestedAt: { lt: cutoff } },
    data: { status: 'expired' },
  });

  return result.count;
}
