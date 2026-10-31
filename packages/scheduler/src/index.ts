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
 *     la cola y que la web sigue exportando;
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
  startPollingLoop,
  startFirmwareAuditLoop,
  startFecCollectionLoop,
} from './scheduler';

export {
  markExpected,
  markNotExpected,
  recordSuccess,
  recordError,
  recordSyslogBound,
  recordSnmpBound,
  snapshotHealth,
  detectHangedLoops,
  overallHealthy,
  __resetSchedulerHealth,
  type SchedulerName,
  type ServiceHealth,
} from './health';
