/**
 * Delegation to `@ftth-copilot/ingest`.
 *
 * The mapping of a normalised SNMP trap onto the device event row left the
 * Next.js process with the rest of the durable ingest path.
 *
 * This module keeps the web's public API: every export it had before is still
 * exported here, so every importer of `@/lib/monitoring/snmp-ingest` keeps
 * working unchanged.
 */

export {
  describeTrap,
  mapTrapCategory,
  mapTrapSeverity,
  spoolSnmpTrap,
} from '@ftth-copilot/ingest';
