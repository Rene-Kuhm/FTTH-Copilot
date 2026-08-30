import { collectSamples, persistSamples, runRetention } from '@ftth-copilot/analytics';
import { runDetection } from '@ftth-copilot/alerts';
import type { INmsConnector } from '@ftth-copilot/connectors-core';

export interface PollMeta {
  tenantId: string;
  connectionId: string;
}

export interface PollEntry {
  connector: INmsConnector;
  meta: PollMeta;
}

export interface PollCycleOptions {
  now?: Date;
  /** Fan out to getOltDetail() per OLT for temperature/uptime (rate-limit aware). */
  includeOltDetail?: boolean;
  /** Purge metric samples older than this many days (once per poll, not per connection). */
  retentionDays?: number;
  webhookUrl?: string;
  cooldownMs?: number;
  lookbackMs?: number;
}

export interface PollCycleResult {
  tenantId: string;
  connectionId: string;
  samples: number;
  detected: number;
  upserted: number;
  notified: number;
  notificationError?: string;
}

export interface PollAllResult {
  results: PollCycleResult[];
  errors: Array<{ tenantId: string; connectionId: string; error: string }>;
  deleted: number;
}

/**
 * One poll cycle for a single connection: sample the connector, persist the
 * samples, then run detection and notification.
 */
export async function runPollCycle(
  connector: INmsConnector,
  meta: PollMeta,
  opts: PollCycleOptions = {},
): Promise<PollCycleResult> {
  const now = opts.now ?? new Date();

  const points = await collectSamples(connector, meta, {
    now,
    includeOltDetail: opts.includeOltDetail,
  });
  const { inserted } = await persistSamples(points);

  const detection = await runDetection({
    tenantId: meta.tenantId,
    connectionId: meta.connectionId,
    now,
    webhookUrl: opts.webhookUrl,
    cooldownMs: opts.cooldownMs,
    lookbackMs: opts.lookbackMs,
  });

  return {
    tenantId: meta.tenantId,
    connectionId: meta.connectionId,
    samples: inserted,
    detected: detection.detected,
    upserted: detection.upserted,
    notified: detection.notified,
    notificationError: detection.notificationError,
  };
}

/**
 * Polls every connection, isolating failures so one broken connection never
 * stops the others, and runs retention once at the end.
 */
export async function pollConnections(
  entries: PollEntry[],
  opts: PollCycleOptions = {},
): Promise<PollAllResult> {
  const results: PollCycleResult[] = [];
  const errors: PollAllResult['errors'] = [];

  for (const entry of entries) {
    try {
      results.push(await runPollCycle(entry.connector, entry.meta, opts));
    } catch (err) {
      errors.push({
        tenantId: entry.meta.tenantId,
        connectionId: entry.meta.connectionId,
        error: err instanceof Error ? err.message : 'Unknown',
      });
    }
  }

  let deleted = 0;
  if (opts.retentionDays !== undefined) {
    deleted = (await runRetention({ retentionDays: opts.retentionDays, now: opts.now })).deleted;
  }

  return { results, errors, deleted };
}
