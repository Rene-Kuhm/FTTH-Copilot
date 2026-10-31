/**
 * Registry of job handlers.
 *
 * The worker is an *execution host*: it does not own domain logic, it
 * translates a queued job into a call to a package function
 * (`@ftth-copilot/monitoring`, `@ftth-copilot/soc`, ...). That translation
 * is the only thing this registry holds.
 *
 * The map is **empty on purpose** — this task ships a deployable, observable
 * process before any work moves to it (Phase 3+ registers the real handlers,
 * one job at a time, each in its own reviewable change). A job name with no
 * handler is a wiring bug, not a transient failure: `defineWorker` throws so
 * BullMQ retries the job and finally dead-letters it, instead of silently
 * dropping the work.
 */

import { type JobHandlers, type JobName } from '@ftth-copilot/jobs';

/**
 * Job name → handler.
 *
 * Explicit and typed on purpose: the handler map is the single place where a
 * job name becomes work. It is never looked up dynamically, so a typo
 * cannot hide in a string built at runtime.
 *
 * Example of the shape a handler takes (Phase 3, task T6):
 *
 * ```ts
 * export const JOB_HANDLERS: JobHandlers = {
 *   'poll-connections': async (data) => pollConnections(data),
 * };
 * ```
 */
export const JOB_HANDLERS: JobHandlers = {
  // Intentionally empty: no job is handled yet (see the module comment).
};

/**
 * Names of the jobs this worker can execute right now.
 *
 * Empty while the registry is empty — the entrypoint logs it so an operator
 * can tell "no work wired yet" from "work wired but not running".
 */
export function registeredJobNames(): JobName[] {
  return Object.keys(JOB_HANDLERS) as JobName[];
}
