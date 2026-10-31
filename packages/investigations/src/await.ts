import {
  prisma,
  getInvestigationVersionById,
  type PersistedInvestigationVersion,
} from '@ftth-copilot/db';

/**
 * Espera acotada del resultado de un intento que ejecuta otro proceso.
 *
 * En modo `worker` la ruta encola el intento y no corre el pipeline; para
 * responder 201 cuando el worker termina rápido, consulta la base hasta el
 * presupuesto HTTP. Consulta Postgres y no eventos de Redis a propósito: el
 * resultado vive en la base, y una suscripción a eventos por request sería una
 * conexión más por cada clic.
 */

/** Qué pasó con el intento al vencer o antes de vencer la espera. */
export type AwaitedAttempt =
  | { kind: 'ready'; version: PersistedInvestigationVersion }
  | { kind: 'failed' }
  | { kind: 'timeout' };

/** Argumentos de la espera. */
export interface AwaitAttemptArgs {
  tenantId: string;
  runId: string;
  versionId: string;
  timeoutMs: number;
  /** Cada cuánto consultar. Default 250 ms. */
  pollMs?: number;
}

const DEFAULT_POLL_MS = 250;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Consulta hasta que la versión de este intento exista, el intento falle, o
 * venza el presupuesto. Una versión guardada cuenta como `ready` aunque el run
 * ya no apunte a este intento: es el resultado de lo que se pidió.
 */
export async function awaitAttemptOutcome(args: AwaitAttemptArgs): Promise<AwaitedAttempt> {
  const pollMs = args.pollMs ?? DEFAULT_POLL_MS;
  const deadline = Date.now() + args.timeoutMs;

  for (;;) {
    const version = await getInvestigationVersionById({
      tenantId: args.tenantId,
      runId: args.runId,
      versionId: args.versionId,
    });
    if (version) return { kind: 'ready', version };

    const run = await prisma.investigationRun.findFirst({
      where: { tenantId: args.tenantId, runId: args.runId },
      select: { status: true, currentVersionId: true },
    });
    if (run?.currentVersionId === args.versionId && run.status === 'failed') {
      return { kind: 'failed' };
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) return { kind: 'timeout' };
    await sleep(Math.min(pollMs, remaining));
  }
}
