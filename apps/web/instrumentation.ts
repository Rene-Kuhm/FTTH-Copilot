/**
 * Next.js server instrumentation — runs once when the Node.js server starts.
 * Boots the proactive metrics poller, the firmware audit loop, the FEC
 * collection loop, and the syslog (SOC) receiver. All stay off unless their
 * env flags are set, so dev, preview and test instances never poll the NMS,
 * scan firmware, fetch FEC telemetry, or bind a UDP socket in the
 * background.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startPollingLoop, startFirmwareAuditLoop, startFecCollectionLoop } =
      await import('@/lib/monitoring/scheduler');
    startPollingLoop();
    startFirmwareAuditLoop();
    startFecCollectionLoop();

    const { startSyslogReceiver } = await import('@/lib/monitoring/syslog');
    startSyslogReceiver();
  }
}
