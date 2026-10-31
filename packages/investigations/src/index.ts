/**
 * `@ftth-copilot/investigations` — el pipeline de investigación y su cierre.
 *
 * Vive en un package porque el worker no puede importar de la app Next, y
 * porque el cierre tiene que ser el mismo lo ejecute quien lo ejecute.
 */

export {
  runInvestigationPipeline,
  type RunInvestigationPipelineArgs,
} from './pipeline';

export { consumeInvestigationQuota } from './quota';

export {
  completeInvestigation,
  failInvestigation,
  expireStaleRuns,
  type CompleteInvestigationArgs,
  type CompleteInvestigationResult,
  type FailInvestigationArgs,
  type ExpireStaleRunsArgs,
} from './complete';
