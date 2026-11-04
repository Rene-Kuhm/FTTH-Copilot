/**
 * Lo que la web usa del pipeline de investigaciones.
 *
 * El pipeline corre en el worker: la web sólo reclama el intento, encola el
 * trabajo y espera el resultado. Por eso el shim exporta exactamente tres
 * cosas —un `export *` traía también `runInvestigationPipeline` y
 * `completeInvestigation`, que son las del worker—: que la web no tenga en
 * el bundle la capacidad de correr la investigación en proceso.
 */

export {
  awaitAttemptOutcome,
  claimInvestigationAttempt,
  failInvestigation,
  type AwaitAttemptArgs,
  type AwaitedAttempt,
} from '@ftth-copilot/investigations';
