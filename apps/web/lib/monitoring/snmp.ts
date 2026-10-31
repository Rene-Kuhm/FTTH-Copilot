/**
 * Delegation to `@ftth-copilot/ingest`.
 *
 * The SNMP trap receiver left the Next.js process: the worker now owns the
 * UDP socket, spools every trap into the durable spool and drains it through
 * the durable job queue, while the web keeps using the same code in embedded
 * mode.
 *
 * This module keeps the web's public API: every export it had before is still
 * exported here, so every importer of `@/lib/monitoring/snmp` keeps working
 * unchanged.
 */

export {
  startSnmpReceiver,
  type SnmpReceiverOptions,
  type SnmpStopFn,
} from '@ftth-copilot/ingest';
