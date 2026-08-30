/**
 * Next.js server instrumentation — runs once when the Node.js server starts.
 * Boots the proactive metrics poller and the syslog (SOC) receiver. Both stay
 * off unless their env flags are set, so dev, preview and test instances never
 * poll the NMS or bind a socket in the background.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startPollingLoop } = await import('@/lib/monitoring/scheduler');
    startPollingLoop();

    const { startSyslogReceiver } = await import('@/lib/monitoring/syslog');
    startSyslogReceiver();
  }
}
