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
    const result = await drainSpool();
    if (result.failed > 0) {
      throw new Error(
        `ingest drain could not store ${result.failed} events; they stay in the spool`,
      );
    }
    return result;
  },
};

/**
 * Names of the jobs this worker can execute right now.
 *
 * The entrypoint logs it so an operator can tell "no work wired yet" from
 * "work wired but not running".
 */
export function registeredJobNames(): JobName[] {
  return Object.keys(JOB_HANDLERS) as JobName[];
}
