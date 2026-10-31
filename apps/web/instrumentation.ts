/**
 * Next.js server instrumentation — runs once when the Node.js server starts.
 *
 * Under `BACKEND_MODE=embedded` (the default) the web owns the background
 * work: it boots the proactive metrics poller, the firmware audit loop, the
 * FEC collection loop, the syslog (SOC) receiver and the SNMP trap receiver.
 * All stay off unless their env flags are set, so dev, preview and test
 * instances never poll the NMS, scan firmware, fetch FEC telemetry, or bind a
 * UDP socket in the background.
 *
 * Under `BACKEND_MODE=worker` the recurring loops belong to the
 * `services/worker` process, which runs them as jobs of the durable queue.
 * The web then serves HTTP and the SSE stream, and nothing else: it does not
 * poll, it does not audit, it does not collect FEC telemetry, and it does
 * not schedule anything.
 *
 * The syslog and SNMP receivers still live in the web: the worker does not
 * receive them yet (tasks T9 and T10 of the extraction), and moving them
 * before it can receive them would silently drop every trap and every
 * syslog message.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { workerOwnsBackgroundWork } = await import('@ftth-copilot/jobs');

    if (workerOwnsBackgroundWork()) {
      // The loops run in the worker. Marking them as "not expected" keeps
      // /api/health honest: this process is not supposed to run them, so
      // they must not be reported as hung loops here.
      const { markNotExpected } = await import('@/lib/monitoring/scheduler-health');
      markNotExpected('polling');
      markNotExpected('firmware');
      markNotExpected('fec');

      console.log(
        '[instrumentation] BACKEND_MODE=worker — the recurring loops run in services/worker',
      );
    } else {
      const { startPollingLoop, startFirmwareAuditLoop, startFecCollectionLoop } =
        await import('@/lib/monitoring/scheduler');
      startPollingLoop();
      startFirmwareAuditLoop();
      startFecCollectionLoop();
    }

    const { startSyslogReceiver } = await import('@/lib/monitoring/syslog');
    startSyslogReceiver();

    // The SNMP receiver was implemented and unit-tested but never wired here,
    // so SNMP_RECEIVER_ENABLED=true used to expose port 1162 with nothing
    // binding it. It stays off by default; this only honours the existing flag.
    if (process.env.SNMP_RECEIVER_ENABLED === 'true') {
      const [
        { startSnmpReceiver },
        { spoolSnmpTrap },
        { startEventDrainer },
        { storeEvidence },
      ] = await Promise.all([
        import('@/lib/monitoring/snmp'),
        import('@/lib/monitoring/snmp-ingest'),
        import('@/lib/monitoring/event-ingest'),
        import('@/lib/monitoring/snmp-evidence'),
      ]);

      // Shared with syslog and idempotent, so enabling only SNMP still drains.
      startEventDrainer();

      startSnmpReceiver({
        onEvent: (event) => {
          spoolSnmpTrap(event);
        },
        onEvidence: (envelope) => {
          // Raw evidence goes to its own store under the retention policy, not
          // through the ingest spool: it is for forensics, not for the
          // dashboard, and it carries a different lifecycle.
          void storeEvidence('default-tenant', envelope).catch(() => {
            // Never let evidence persistence disturb trap reception.
          });
        },
      });
    }
  }
}
