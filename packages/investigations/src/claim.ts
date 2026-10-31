import { randomUUID } from 'node:crypto';
import { prisma } from '@ftth-copilot/db';

/**
 * Arranque atómico de un intento de investigación.
 *
 * La tabla es única por `(tenantId, runId)`, no por incidente. Sin este claim,
 * dos pedidos simultáneos ven los dos "no hay run", crean dos filas para el
 * mismo incidente y corren dos pipelines. Un lock transaccional de Postgres por
 * `(tenantId, incidentId)` serializa la decisión: el segundo pedido espera al
 * primero, ve su intento `pending` y no arranca otro. No hace falta cambiar el
 * schema (y un índice único por incidente fallaría si ya hubiera duplicados).
 */

/** Pedido de un intento. */
export interface ClaimInvestigationArgs {
  tenantId: string;
  incidentId: string;
  connectionId: string | null;
  userId: string;
  /** `true` relanza aunque haya un resultado `ready`. */
  refresh: boolean;
  now?: Date;
  /**
   * Punto de prueba: corre entre la lectura y la escritura, dentro de la
   * transacción. Los tests lo usan para ensanchar la ventana de la carrera y
   * demostrar que sin el lock dos pedidos crean dos intentos. No se usa en
   * producción.
   */
  betweenReadAndWrite?: () => Promise<void>;
}

/** Qué decidió el claim. */
export type ClaimOutcome =
  /** Este pedido es dueño de un intento nuevo: hay que ejecutarlo. */
  | { kind: 'claimed'; runId: string; versionId: string; attemptStartedAt: Date }
  /** Ya hay un intento en curso: no se arranca otro. */
  | { kind: 'pending'; runId: string }
  /** Ya hay un resultado y no se pidió refresco. */
  | { kind: 'ready'; runId: string };

/** Id opaco con el mismo formato que ya usaba la ruta (`r_`/`v_` + 32 hex). */
function opaqueId(prefix: 'r' | 'v'): string {
  return `${prefix}_${randomUUID().replace(/-/g, '')}`;
}

/**
 * Decide, bajo lock, si este pedido arranca un intento.
 *
 * - `pending` → ya hay uno en curso (el barrido lo expira si quedó colgado).
 * - `ready` sin `refresh` → devolver el resultado existente.
 * - cualquier otro caso (`failed`, `expired`, `ready` con `refresh`, o sin
 *   fila) → nuevo intento: run `pending`, `currentVersionId` y
 *   `attemptStartedAt` del intento.
 */
export async function claimInvestigationAttempt(args: ClaimInvestigationArgs): Promise<ClaimOutcome> {
  const attemptStartedAt = args.now ?? new Date();

  return prisma.$transaction(async (tx) => {
    // Lock por incidente hasta el fin de la transacción. `hashtextextended`
    // devuelve un bigint estable para la misma clave en todos los procesos.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`investigation:${args.tenantId}:${args.incidentId}`}, 0))`;

    const existing = await tx.investigationRun.findFirst({
      where: { tenantId: args.tenantId, incidentId: args.incidentId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, runId: true, status: true },
    });

    await args.betweenReadAndWrite?.();

    if (existing?.status === 'pending') {
      return { kind: 'pending', runId: existing.runId };
    }
    if (existing?.status === 'ready' && !args.refresh) {
      return { kind: 'ready', runId: existing.runId };
    }

    const versionId = opaqueId('v');

    if (existing) {
      await tx.investigationRun.update({
        where: { id: existing.id },
        data: { status: 'pending', currentVersionId: versionId, attemptStartedAt },
      });
      return { kind: 'claimed', runId: existing.runId, versionId, attemptStartedAt };
    }

    const runId = opaqueId('r');
    await tx.investigationRun.create({
      data: {
        tenantId: args.tenantId,
        connectionId: args.connectionId,
        incidentId: args.incidentId,
        requestedByUserId: args.userId,
        runId,
        status: 'pending',
        currentVersionId: versionId,
        attemptStartedAt,
      },
    });
    return { kind: 'claimed', runId, versionId, attemptStartedAt };
  });
}
