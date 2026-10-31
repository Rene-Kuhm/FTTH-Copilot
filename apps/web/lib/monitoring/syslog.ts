/**
 * Delegation to `@ftth-copilot/ingest`.
 *
 * The syslog receiver left the Next.js process: the worker binds the UDP
 * socket now, spools every datagram into the durable spool and enqueues the
 * drain job. The web keeps the same receiver in embedded mode.
 *
 * The wrapper keeps the web's public API exactly as it was — no options —
 * so `startSyslogReceiver()` behaves identically to before the move.
 */

import { startSyslogReceiver as startReceiver } from '@ftth-copilot/ingest';

/**
 * Starts the UDP syslog receiver plus a periodic SOC detection pass.
 *
 * Disabled unless SYSLOG_RECEIVER_ENABLED=true and SYSLOG_TENANT_ID is set,
 * so dev, preview and test instances never bind a socket.
 */
export function startSyslogReceiver(): () => void {
  return startReceiver();
}
