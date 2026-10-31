import { prisma } from '@ftth-copilot/db';
import type { InvestigationResult } from '@ftth-copilot/shared';
import { completeInvestigation, failInvestigation } from './complete';
import { runInvestigationPipeline, type RunInvestigationPipelineArgs } from './pipeline';

/**
 * Ejecución de UN intento de investigación, sea quien sea el ejecutor.
 *
 * El worker la llama por cada job; el handler solo traduce el resultado a lo
 * que BullMQ entiende (reintentar o no). Vive acá, y no en el worker, para que
 * la decisión de reintentar o fallar sea una función testeable y no cableado.
 */

/** Lo que el ejecutor necesita para correr un intento. */
export interface InvestigationAttempt {
  tenantId: string;
  incidentId: string;
  runId: string;
  versionId: string;
  userId: string;
  windowDays?: number;
  startedAtMs: number;
}

/** Cómo terminó un intento. */
export type AttemptOutcome =
  /** El resultado quedó guardado; `applied` dice si el run pasó a `ready`. */
  | { status: 'completed'; versionId: string; versionIndex: number; applied: boolean }
  /** El intento ya no era el vigente: no se corrió nada. */
  | { status: 'skipped'; reason: string }
  /** Falla pasajera con intentos restantes: hay que reintentar. */
  | { status: 'retry'; error: unknown }
  /** Falla definitiva: el run quedó `failed` (si este intento era el vigente). */
  | { status: 'failed'; reason: string };

/** Contexto de reintentos que da la cola. */
export interface AttemptRetryContext {
  /** Intentos ya hechos antes de este (0 en el primero). */
  attemptsMade: number;
  /** Tope total de intentos. */
  maxAttempts: number;
}

/** Inyectable para tests: por defecto, el pipeline real. */
export type PipelineRunner = (args: RunInvestigationPipelineArgs) => Promise<InvestigationResult>;

const TRANSIENT_PRISMA_CODES = new Set(['P1001', 'P1002', 'P1008', 'P1017', 'P2024', 'P2028']);
const TRANSIENT_SOCKET_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
]);

/**
 * ¿Vale la pena reintentar este error?
 *
 * Solo los pasajeros: base o red caídas, timeouts, y respuestas HTTP 429/5xx
 * de un proveedor. Un error de validación o de datos falla igual en el
 * siguiente intento, y reintentarlo solo gasta tiempo (y, con un proveedor de
 * LLM, dinero).
 */
export function isRetryableInvestigationError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code, status, name } = error as { code?: unknown; status?: unknown; name?: unknown };
  if (name === 'PrismaClientInitializationError') return true;
  if (typeof code === 'string') {
    if (TRANSIENT_PRISMA_CODES.has(code) || TRANSIENT_SOCKET_CODES.has(code)) return true;
  }
  if (typeof status === 'number') {
    if (status === 429 || (status >= 500 && status <= 599)) return true;
  }
  return false;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Corre un intento de investigación de punta a punta.
 *
 * 1. Re-verifica que el incidente sea del tenant del payload: un payload no es
 *    una credencial, y el worker no tiene la sesión del usuario.
 * 2. Verifica que el intento siga siendo el vigente y esté `pending`. Si lo
 *    reemplazó otro o lo expiró el barrido, no corre nada.
 * 3. Corre el pipeline y cierra con `completeInvestigation`.
 * 4. Ante un error: reintenta si es pasajero y quedan intentos; si no, deja el
 *    run `failed` para que el incidente se pueda volver a investigar.
 */
export async function executeInvestigationAttempt(
  attempt: InvestigationAttempt,
  retry: AttemptRetryContext,
  runPipeline: PipelineRunner = runInvestigationPipeline,
): Promise<AttemptOutcome> {
  const incident = await prisma.incident.findFirst({
    where: { id: attempt.incidentId, tenantId: attempt.tenantId },
    select: { id: true, deviceId: true, deviceKind: true, connectionId: true },
  });
  if (!incident) {
    const reason = `incident ${attempt.incidentId} not found for tenant ${attempt.tenantId}`;
    await failInvestigation({ ...attempt, reason });
    return { status: 'failed', reason };
  }

  const run = await prisma.investigationRun.findFirst({
    where: { tenantId: attempt.tenantId, runId: attempt.runId },
    select: { status: true, currentVersionId: true, incidentId: true },
  });
  if (!run || run.incidentId !== incident.id) {
    const reason = `run ${attempt.runId} does not belong to incident ${incident.id}`;
    await failInvestigation({ ...attempt, reason });
    return { status: 'failed', reason };
  }
  if (run.status !== 'pending' || run.currentVersionId !== attempt.versionId) {
    return {
      status: 'skipped',
      reason: `attempt ${attempt.versionId} is no longer in flight (run is ${run.status})`,
    };
  }

  try {
    const result = await runPipeline({
      tenantId: attempt.tenantId,
      incidentId: incident.id,
      runId: attempt.runId,
      versionId: attempt.versionId,
      deviceId: incident.deviceId,
      deviceKind: incident.deviceKind,
      connectionId: incident.connectionId ?? null,
      windowDays: attempt.windowDays,
    });
    const closed = await completeInvestigation({
      tenantId: attempt.tenantId,
      runId: attempt.runId,
      versionId: attempt.versionId,
      incidentId: incident.id,
      userId: attempt.userId,
      investigationResult: result,
      startedAtMs: attempt.startedAtMs,
    });
    return { status: 'completed', ...closed };
  } catch (error) {
    const attemptsLeft = retry.attemptsMade + 1 < retry.maxAttempts;
    if (attemptsLeft && isRetryableInvestigationError(error)) {
      return { status: 'retry', error };
    }
    const reason = describe(error);
    await failInvestigation({ ...attempt, reason });
    return { status: 'failed', reason };
  }
}
