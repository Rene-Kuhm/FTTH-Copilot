/**
 * `@ftth-copilot/jobs` — the typed entry point to the durable job queue.
 *
 * The web produces jobs, the worker consumes them, and both agree on the
 * names and payloads defined in `definitions.ts`.
 */

export {
  QUEUE_NAMES,
  JOB_NAMES,
  sanitizeJobScope,
  windowJobId,
  ingestDrainJobId,
  recurringSchedulerId,
  type QueueKey,
  type JobName,
  type JobPayload,
  type QueueData,
  type JobNameFor,
  type QueueJobMap,
  type JobPayloadMap,
  type PollConnectionsPayload,
  type FirmwareAuditPayload,
  type FecCollectionPayload,
  type IngestDrainPayload,
} from './definitions';

export {
  BACKEND_MODES,
  DEFAULT_BACKEND_MODE,
  backendMode,
  workerOwnsBackgroundWork,
  type BackendMode,
} from './backend-mode';

export {
  DEFAULT_REDIS_URL,
  redisUrl,
  redisConnectionOptions,
  workerRedisConnectionOptions,
  type RedisConnectionOptions,
} from './connection';

export { toJobsOptions, type EnqueueOptions } from './options';
