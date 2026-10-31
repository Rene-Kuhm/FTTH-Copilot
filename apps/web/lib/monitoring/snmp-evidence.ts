/**
 * Delegation to `@ftth-copilot/ingest`.
 *
 * The store of the raw SNMP trap evidence left the Next.js process with the
 * rest of the durable ingest path. It keeps its own retention policy: it is
 * forensics, not a dashboard event.
 *
 * This module keeps the web's public API: every export it had before is still
 * exported here, so every importer of `@/lib/monitoring/snmp-evidence` keeps
 * working unchanged.
 */

export {
  EVIDENCE_RETENTION_DAYS,
  normalizeEvidence,
  purgeExpiredEvidence,
  purgeTenantEvidence,
  readIdentifyingVars,
  retentionDeadline,
  storeEvidence,
  type NormalizedEvidence,
} from '@ftth-copilot/ingest';
