/**
 * `@ftth-copilot/scheduler` — el trabajo de fondo recurrente, fuera de la web.
 *
 * Antes de que existiera este package, los loops vivían dentro del proceso
 * Next.js (`apps/web/lib/monitoring/scheduler.ts`): el poller de métricas, la
 * auditoría de firmware y la colección FEC corrían con `setInterval` en el
 * mismo event loop que atiende el HTTP, y morían en cada deploy de la UI.
 *
 * Este package es el hogar de ese trabajo:
 *
 *   - las unidades ejecutables (`runScheduledPoll`, `runScheduledFirmwareAudit`,
 *     `runScheduledFecCollection`), que el worker llama desde los handlers de
 *     la cola;
 *   - los ayudantes de concurrencia (single-flight y lock consultivo de
 *     Postgres), que siguen siendo la garantía de que un tick no se
 *     solapa con otro;
 *   - el registro de salud por proceso, que `/api/health` lee.
 *
 * La web re-exporta todo desde `apps/web/lib/monitoring/scheduler.ts` y
 * `apps/web/lib/monitoring/scheduler-health.ts`: sus importadores no cambian.
 */

export {
  advisoryLockKey,
  acquireSchedulerLock,
  __clearSchedulerState,
  tryStart,
  runScheduledPoll,
  runScheduledFirmwareAudit,
  runScheduledFecCollection,
} from './scheduler';

export {
  markExpected,
  markNotExpected,
  recordSuccess,
  recordError,
  recordSyslogBound,
  recordSnmpBound,
  serviceStatus,
  setNextRun,
  withServiceStatus,
  snapshotHealth,
  detectHangedLoops,
  overallHealthy,
  __resetSchedulerHealth,
  TICK_GRACE_MS,
  type LoopCadence,
  type SchedulerName,
  type ServiceHealth,
  type ServiceStatus,
} from './health';

export {
  DEFAULT_DEGRADED_ONU_TTL_MS,
  recordDegradedOnu,
  snapshotDegradedOnus,
  __resetDegradedOnusForTests,
  type DegradedOnuReason,
  type DegradedOnuScope,
  type DegradedOnuSignal,
} from './degraded-onus';

export { rankFecCandidates, type FecPriorityInput } from './fec-priority';

export {
  DEFAULT_DEGRADED_RX_THRESHOLD_DBM,
  onuEventPoints,
  type OnuEventPointsOptions,
  type OnuEventPointsResult,
} from './event-points';

export {
  DEFAULT_EVENT_LIVENESS_MS,
  DEFAULT_EVENT_MAX_STREAMS_PER_ACCOUNT,
  SMARTOLT_EVENTS_FLAG,
  SMARTOLT_EVENTS_HEALTH_NAME,
  startSmartoltEventStreams,
  type SmartoltEventConnectionRecord,
  type SmartoltEventCredentials,
  type SmartoltEventLoopHandle,
  type SmartoltEventLoopOptions,
  type SmartoltEventStreamFactory,
  type SmartoltEventStreamLike,
} from './event-stream';

export {
  WORKER_HEALTH_KEY,
  WORKER_HEALTH_TTL_SECONDS,
  buildWorkerHealthSnapshot,
  parseWorkerHealthSnapshot,
  type WorkerHealthSnapshot,
} from './health-snapshot';
