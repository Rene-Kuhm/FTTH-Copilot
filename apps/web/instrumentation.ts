/**
 * Next.js server instrumentation — runs once when the Node.js server starts.
 * Used to boot the proactive metrics poller. The poller stays off unless
 * METRICS_POLLER_ENABLED=true, so dev, preview and test instances never hit the
 * NMS in the background.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startPollingLoop } = await import('@/lib/monitoring/scheduler');
    startPollingLoop();
  }
}
