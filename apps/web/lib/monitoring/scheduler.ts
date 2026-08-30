import { prisma } from '@ftth-copilot/db';
import { pollConnections, type PollEntry } from '@ftth-copilot/monitoring';
import { buildConnectorFromConnection } from '@/lib/connectors/chat-client';

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * One scheduled poll: build a live connector for every `connected` connection
 * and run the sample -> persist -> detect -> notify cycle for each. A connection
 * that cannot be built (e.g. decryption failure) is skipped without aborting the
 * rest.
 */
export async function runScheduledPoll() {
  const connections = await prisma.nmsConnection.findMany({
    where: { status: 'connected' },
  });

  const entries: PollEntry[] = [];
  for (const connection of connections) {
    try {
      const { connector } = buildConnectorFromConnection(connection);
      entries.push({
        connector,
        meta: { tenantId: connection.tenantId, connectionId: connection.id },
      });
    } catch {
      // Skip unbuildable connections.
    }
  }

  return pollConnections(entries, {
    retentionDays: positiveInt(process.env['METRICS_RETENTION_DAYS'], 30),
    webhookUrl: process.env['ALERT_WEBHOOK_URL'],
    cooldownMs: positiveInt(process.env['ALERT_COOLDOWN_MS'], 60 * 60 * 1000),
    resolveAfterMs: positiveInt(process.env['ALERT_RESOLVE_AFTER_MS'], 24 * 60 * 60 * 1000),
    escalateAfterMs: positiveInt(process.env['ALERT_ESCALATE_AFTER_MS'], 4 * 60 * 60 * 1000),
    includeOltDetail: process.env['METRICS_SAMPLE_OLT_DETAIL'] === 'true',
  });
}

/**
 * Starts the background poller when METRICS_POLLER_ENABLED=true. Disabled by
 * default so tests, previews and one-off instances never poll the NMS.
 */
export function startPollingLoop(): () => void {
  if (process.env['METRICS_POLLER_ENABLED'] !== 'true') return () => {};

  const intervalMs = positiveInt(process.env['METRICS_POLL_INTERVAL_MS'], 15 * 60 * 1000);
  const timer = setInterval(() => {
    runScheduledPoll().catch(() => {});
  }, intervalMs);

  // First run shortly after boot, without blocking startup.
  setTimeout(() => {
    runScheduledPoll().catch(() => {});
  }, 5000);

  return () => clearInterval(timer);
}
