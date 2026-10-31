import {
  createJobQueue,
  enqueueJob,
  investigationJobId,
  redisConnectionOptions,
  type InvestigationRunPayload,
  type JobQueue,
} from '@ftth-copilot/jobs';

/**
 * Productor de intentos de investigación desde la web (modo `worker`).
 *
 * La cola se abre una vez por proceso: abrir una conexión a Redis por request
 * sería una conexión nueva por cada clic en "investigar".
 */

/** Reintentos de un intento: pocos, porque cada uno puede costar LLM. */
export const INVESTIGATION_JOB_ATTEMPTS = 3;

let queue: JobQueue<'investigation'> | null = null;

function investigationQueue(): JobQueue<'investigation'> {
  if (queue === null) {
    queue = createJobQueue('investigation', redisConnectionOptions(process.env));
    queue.on('error', (error: Error) => {
      console.warn(`[investigate] queue error: ${error.message}`);
    });
  }
  return queue;
}

/**
 * Encola un intento con un id fijo por `runId` + `versionId`: un doble clic o
 * un request reintentado no puede encolar el mismo intento dos veces.
 */
export async function enqueueInvestigationAttempt(payload: InvestigationRunPayload): Promise<void> {
  await enqueueJob(investigationQueue(), 'investigation-run', payload, {
    jobId: investigationJobId(payload.runId, payload.versionId),
    attempts: INVESTIGATION_JOB_ATTEMPTS,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: 1000,
    removeOnFail: 1000,
  });
}
