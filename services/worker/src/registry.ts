/**
 * Registry of job handlers.
 *
 * The worker is an *execution host*: it does not own domain logic, it
 * translates a queued job into a call to a package function
 * (`@ftth-copilot/monitoring`, `@ftth-copilot/soc`, ...). That translation
 * is the only thing this registry holds.
 *
 * A job name with no handler is a wiring bug, not a transient failure:
 * `defineWorker` throws so BullMQ retries the job and finally dead-letters it,
 * instead of silently dropping the work.
 */

import { type JobHandlers, type JobName } from '@ftth-copilot/jobs';
import { drainSpool } from '@ftth-copilot/ingest';
import { executeInvestigationAttempt, expireStaleRuns } from '@ftth-copilot/investigations';
import {
  runScheduledFecCollection,
  runScheduledFirmwareAudit,
  runScheduledPoll,
  tryStart,
} from '@ftth-copilot/scheduler';

/**
 * Job name → handler.
 *
 * Explicit and typed on purpose: the handler map is the single place where a
 * job name becomes work. It is never looked up dynamically, so a typo
 * cannot hide in a string built at runtime.
 *
 * Every handler runs its tick through `tryStart`, the single-flight guard of
 * `@ftth-copilot/scheduler`: it is the same call the in-process loop made, so
 * an overlapping tick is skipped and a failing tick is logged instead of
 * killing the loop.
 */
export const JOB_HANDLERS: JobHandlers = {
  'poll-connections': async () => {
    await tryStart('polling', runScheduledPoll);
  },
  'firmware-audit': async () => {
    await tryStart('firmware', runScheduledFirmwareAudit);
  },
  'fec-collection': async () => {
    await tryStart('fec', runScheduledFecCollection);
  },
  /**
   * Drains the durable spool into Postgres.
   *
   * The handler drains the whole spool, not only the event of the payload:
   * an enqueue that was lost with the queue down must not leave the event
   * on disk forever. The next job (of the next event, or the retry of this
   * one) drains it.
   *
   * A failed batch leaves the events on disk, so the job fails and BullMQ
   * retries it with a backoff instead of dropping the work.
   */
  'ingest-drain': async () => {
    const result = await drainSpool({
      onSharedFailure: (code, count) => {
        // Every event failed the same way: the database is not ready (a
        // migration that did not run, a missing permission). This is an
        // operator alert, not data loss: nothing was dead-lettered.
        console.error(
          `[worker] ALERT ingest drain: all ${count} events failed with ${code}. ` +
            'The events stay in the spool; check the schema and permissions.',
        );
      },
    });
    if (result.failed > 0) {
      throw new Error(
        `ingest drain could not store ${result.failed} events; they stay in the spool`,
      );
    }
    return result;
  },
  /**
   * Runs one attempt of an incident investigation.
   *
   * The decision (retry, fail, skip) lives in `@ftth-copilot/investigations`;
   * this handler only tells BullMQ about it. Throwing is what makes BullMQ
   * retry with its backoff, so only a `retry` outcome throws: a `failed`
   * attempt already left the run `failed`, and retrying it would only run the
   * pipeline again for nothing.
   */
  'investigation-run': async (data, job) => {
    const outcome = await executeInvestigationAttempt(data, {
      attemptsMade: job.attemptsMade,
      maxAttempts: job.opts.attempts ?? 1,
    });
    if (outcome.status === 'retry') {
      throw outcome.error instanceof Error ? outcome.error : new Error(String(outcome.error));
    }
    if (outcome.status === 'failed') {
      console.warn(`[worker] investigation ${data.runId}/${data.versionId} failed: ${outcome.reason}`);
    }
    return outcome;
  },
  /** Expires the investigation attempts that stayed `pending` past their TTL. */
  'investigation-sweep': async (data) => {
    const ttlMs = data.ttlMs ?? investigationPendingTtlMs();
    const expired = await expireStaleRuns({ ttlMs });
    if (expired > 0) {
      console.warn(`[worker] investigation sweep expired ${expired} abandoned attempt(s)`);
    }
    return { expired };
  },
};

/** Default age after which a `pending` investigation attempt is abandoned. */
export const DEFAULT_INVESTIGATION_PENDING_TTL_MS = 15 * 60 * 1000;

/** TTL of a `pending` attempt, from `INVESTIGATION_PENDING_TTL_MS`. */
export function investigationPendingTtlMs(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number.parseInt(env['INVESTIGATION_PENDING_TTL_MS'] ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_INVESTIGATION_PENDING_TTL_MS;
}

/**
 * Names of the jobs this worker can execute right now.
 *
 * The entrypoint logs it so an operator can tell "no work wired yet" from
 * "work wired but not running".
 */
export function registeredJobNames(): JobName[] {
  return Object.keys(JOB_HANDLERS) as JobName[];
}
