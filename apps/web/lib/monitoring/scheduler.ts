import { prisma } from '@ftth-copilot/db';
import { pollConnections, type PollEntry } from '@ftth-copilot/monitoring';
import {
  runFirmwareAudit,
  DEFAULT_VULNERABLE_FIRMWARE,
} from '@ftth-copilot/soc';
import { buildConnectorFromConnection } from '@/lib/connectors/chat-client';

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Reads the comma-separated allowlist from the environment. Empty / unset
 * falls back to `DEFAULT_VULNERABLE_FIRMWARE` so a fresh deployment still
 * gets a sane baseline.
 */
function readVulnerableFirmwareAllowlist(): string[] {
  const raw = process.env['FIRMWARE_AUDIT_VULNERABLE_LIST'];
  if (!raw) return [...DEFAULT_VULNERABLE_FIRMWARE];
  const parsed = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return parsed.length > 0 ? parsed : [...DEFAULT_VULNERABLE_FIRMWARE];
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

  const botToken = process.env['TELEGRAM_BOT_TOKEN'];
  const chatId = process.env['TELEGRAM_CHAT_ID'];

  return pollConnections(entries, {
    retentionDays: positiveInt(process.env['METRICS_RETENTION_DAYS'], 30),
    webhookUrl: process.env['ALERT_WEBHOOK_URL'],
    telegram: botToken && chatId ? { botToken, chatId } : undefined,
    cooldownMs: positiveInt(process.env['ALERT_COOLDOWN_MS'], 60 * 60 * 1000),
    resolveAfterMs: positiveInt(process.env['ALERT_RESOLVE_AFTER_MS'], 24 * 60 * 60 * 1000),
    escalateAfterMs: positiveInt(process.env['ALERT_ESCALATE_AFTER_MS'], 4 * 60 * 60 * 1000),
    includeOltDetail: process.env['METRICS_SAMPLE_OLT_DETAIL'] === 'true',
  });
}

/**
 * One scheduled firmware audit: for each `connected` NMS connection, query
 * live firmware versions and flag any device whose firmware is in the
 * configured vulnerability allowlist. A failure in one connection does not
 * stop the rest of the audit.
 */
export async function runScheduledFirmwareAudit() {
  const connections = await prisma.nmsConnection.findMany({
    where: { status: 'connected' },
  });

  const botToken = process.env['TELEGRAM_BOT_TOKEN'];
  const chatId = process.env['TELEGRAM_CHAT_ID'];
  const vulnerable = readVulnerableFirmwareAllowlist();

  const results: Array<{ connectionId: string; result: unknown }> = [];
  for (const connection of connections) {
    try {
      const { connector } = buildConnectorFromConnection(connection);
      const result = await runFirmwareAudit({
        tenantId: connection.tenantId,
        connectionId: connection.id,
        connector,
        includeOnuDetail: true,
        vulnerable,
        webhookUrl: process.env['ALERT_WEBHOOK_URL'],
        telegram: botToken && chatId ? { botToken, chatId } : undefined,
      });
      results.push({ connectionId: connection.id, result });
    } catch {
      // Skip unbuildable connections.
    }
  }
  return results;
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

/**
 * Starts the firmware audit loop when FIRMWARE_AUDIT_ENABLED=true. The cadence
 * is intentionally much slower than the metrics poller because firmware
 * changes infrequently; the default is 24h.
 */
export function startFirmwareAuditLoop(): () => void {
  if (process.env['FIRMWARE_AUDIT_ENABLED'] !== 'true') return () => {};

  const intervalMs = positiveInt(
    process.env['FIRMWARE_AUDIT_INTERVAL_MS'],
    24 * 60 * 60 * 1000,
  );
  const timer = setInterval(() => {
    runScheduledFirmwareAudit().catch(() => {});
  }, intervalMs);

  // First run shortly after boot, without blocking startup.
  setTimeout(() => {
    runScheduledFirmwareAudit().catch(() => {});
  }, 5000);

  return () => clearInterval(timer);
}
