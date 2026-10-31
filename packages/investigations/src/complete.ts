import { prisma, insertInvestigationVersion } from '@ftth-copilot/db';
import type { InvestigationResult } from '@ftth-copilot/shared';

/**
 * Cierre de una investigación.
 *
 * Vive acá, y no en la ruta, porque hay **dos** ejecutores posibles de la misma
 * investigación: el proceso web (modo `embedded`) y el worker (modo `worker`).
 * Los dos tienen que cerrar el run igual, y duplicar ese cierre es la forma más
 * fácil de que uno de los dos se olvide de guardar el resultado.
 *
 * El control de concurrencia descansa en una idea: la fila `InvestigationRun`
 * es UNA por incidente y se reutiliza entre intentos. Por eso ni `requestedAt`
 * (se escribe al crear la fila) ni un update por `(tenantId, runId)` distinguen
 * un intento de otro. Cada intento se identifica por su `versionId`, guardado
 * en `currentVersionId` cuando arranca, y toda salida de `pending` está
 * condicionada a que ese intento siga siendo el vigente.
 */

/** Las cuatro condiciones de una transición válida fuera de `pending`. */
function attemptInFlight(tenantId: string, runId: string, versionId: string) {
  return { tenantId, runId, status: 'pending', currentVersionId: versionId } as const;
}

/** Argumentos del arranque de un intento. */
export interface BeginInvestigationAttemptArgs {
  tenantId: string;
  runId: string;
  versionId: string;
  now?: Date;
}

/**
 * Marca el arranque de un intento: run en `pending`, el intento como vigente y
 * su hora de inicio. Lo llama la ruta cada vez que pone el run en `pending`,
 * tanto al crear la fila como al relanzar.
 */
export async function beginInvestigationAttempt(args: BeginInvestigationAttemptArgs): Promise<void> {
  await prisma.investigationRun.updateMany({
    where: { tenantId: args.tenantId, runId: args.runId },
    data: {
      status: 'pending',
      currentVersionId: args.versionId,
      attemptStartedAt: args.now ?? new Date(),
    },
  });
}

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
  /**
   * `false` cuando el intento ya no era el vigente (lo reemplazó uno nuevo o lo
   * expiró el barrido): la versión quedó guardada como historia, pero el estado
   * del run no se tocó.
   */
  applied: boolean;
}

/**
 * Guarda la versión, registra la acción y deja el run en `ready`, las tres
 * cosas en una sola transacción: si el proceso muere en el medio no puede
 * quedar una versión guardada con el run todavía `pending`.
 *
 * El paso a `ready` solo se aplica si este intento sigue siendo el vigente. Un
 * intento viejo que termina tarde guarda su versión (es un resultado real y
 * pagado) pero no le cambia el estado al intento nuevo.
 */
export async function completeInvestigation(
  args: CompleteInvestigationArgs,
  now: number = Date.now(),
): Promise<CompleteInvestigationResult> {
  return prisma.$transaction(async (tx) => {
    const persisted = await insertInvestigationVersion(tx, {
      tenantId: args.tenantId,
      runId: args.runId,
      investigationResult: args.investigationResult,
      requestedByUserId: args.userId,
    });

    await tx.agentActionLog.create({
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

    const transition = await tx.investigationRun.updateMany({
      where: attemptInFlight(args.tenantId, args.runId, args.versionId),
      data: { status: 'ready' },
    });

    return {
      versionId: persisted.versionId,
      versionIndex: persisted.versionIndex,
      applied: transition.count === 1,
    };
  });
}

/** Argumentos del cierre fallido. */
export interface FailInvestigationArgs {
  tenantId: string;
  runId: string;
  versionId: string;
  /** Usuario que pidió la investigación, para el registro de la falla. */
  userId: string;
  incidentId?: string | null;
  reason: string;
}

/**
 * Deja el run en `failed` y registra el motivo en `AgentActionLog`.
 *
 * Un run `failed` no bloquea el botón "investigar": el chequeo de "ya hay uno
 * pendiente" solo mira `pending`. El paso a `failed` está condicionado al
 * intento vigente: un intento viejo que falla tarde no puede poner `failed` el
 * run de un intento nuevo (eso habilitaría lanzar un tercero en paralelo).
 * El motivo se registra siempre, aunque la transición no aplique.
 *
 * Devuelve si la transición se aplicó.
 */
export async function failInvestigation(args: FailInvestigationArgs): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const transition = await tx.investigationRun.updateMany({
      where: attemptInFlight(args.tenantId, args.runId, args.versionId),
      data: { status: 'failed' },
    });

    await tx.agentActionLog.create({
      data: {
        tenantId: args.tenantId,
        userId: args.userId,
        toolName: '__investigation_failed__',
        parameters: {
          incidentId: args.incidentId ?? null,
          runId: args.runId,
          versionId: args.versionId,
          applied: transition.count === 1,
        } as unknown as object,
        result: args.runId,
        errorMessage: args.reason.slice(0, 4096),
        durationMs: 0,
      },
    });

    return transition.count === 1;
  });
}

/** Un run que quedó `pending` más tiempo del permitido. */
export interface ExpireStaleRunsArgs {
  /** Edad a partir de la cual un intento `pending` se considera abandonado. */
  ttlMs: number;
  /** Momento de referencia. Defaults to now. */
  now?: number;
}

/**
 * Pasa a `expired` los runs cuyo intento vigente quedó `pending` más que el TTL.
 *
 * Mide la edad del **intento** (`attemptStartedAt`), no de la fila: un
 * incidente investigado hace días y relanzado ahora tiene un `requestedAt`
 * viejo, y expirarlo por eso mataría una investigación en curso. Las filas
 * trabadas antes de existir la columna reciben `attemptStartedAt` por el
 * backfill de la migración; las que igual lo tengan nulo caen al `requestedAt`.
 *
 * Hace falta aunque el bug esté arreglado: un proceso que muere a mitad de una
 * investigación deja la fila `pending`. `expired` no bloquea el botón.
 */
export async function expireStaleRuns(args: ExpireStaleRunsArgs): Promise<number> {
  const now = args.now ?? Date.now();
  const cutoff = new Date(now - args.ttlMs);

  const result = await prisma.investigationRun.updateMany({
    where: {
      status: 'pending',
      OR: [
        { attemptStartedAt: { lt: cutoff } },
        { attemptStartedAt: null, requestedAt: { lt: cutoff } },
      ],
    },
    data: { status: 'expired' },
  });

  return result.count;
}
