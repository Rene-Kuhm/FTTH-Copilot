import { prisma } from '@ftth-copilot/db';
import { pollConnections, type PollEntry } from '@ftth-copilot/monitoring';
import {
  runFirmwareAudit,
  DEFAULT_VULNERABLE_FIRMWARE,
} from '@ftth-copilot/soc';
import type { INmsConnector, OnuSummary } from '@ftth-copilot/connectors-core';
import type { MetricPoint, SampleMeta } from '@ftth-copilot/analytics';
import {
  assembleOnuDetailPoints,
  fitsRateBudget,
  mapAllSettled,
  persistSamples,
  pickFecFanOutSlice,
} from '@ftth-copilot/analytics';
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

/**
 * One scheduled FEC / optical telemetry tick.
 *
 * Bootstraps from env (`FEC_COLLECTION_ENABLED`, `FEC_COLLECTION_INTERVAL_MS`,
 * `FEC_FAN_OUT_PER_CYCLE`, `FEC_RATE_LIMIT_PER_HOUR`), picks a deterministic
 * per-ONU slice via `pickFecFanOutSlice`, gates the fan-out through
 * `fitsRateBudget` (REQ-3 pre-flight), fans out to `getOnuDetail` in
 * parallel under `mapAllSettled` (REQ-5 per-ONU isolation), assembles
 * `MetricPoint[]` per detail (REQ-4 / AD-4 graceful no-op for Mikrowisp),
 * and persists the assembled batch via `persistSamples` (REQ-4 — reuses the
 * existing analytics surface, no new MetricKind, no migration).
 *
 * Detection is intentionally NOT triggered here (REQ-4: "MUST NOT call any
 * detector"). Detection happens downstream on the freshly persisted rows via
 * the existing scheduled detection job.
 *
 * Telemetry (REQ-6): each tick emits one `console.log` line with
 * `{ tenantId, connectionId, requested, persisted, skipped, durationMs }`;
 * each skipped tick emits one `console.warn` line with `{ reason, requested,
 * ... }`. Logs never carry tokens, cookies or `Authorization` headers.
 */
export async function runScheduledFecCollection(): Promise<void> {
  if (process.env['FEC_COLLECTION_ENABLED'] !== 'true') return;

  const intervalMs = positiveInt(process.env['FEC_COLLECTION_INTERVAL_MS'], 3_600_000);
  const sliceSize = positiveInt(process.env['FEC_FAN_OUT_PER_CYCLE'], 8);
  const limitPerHour = positiveInt(process.env['FEC_RATE_LIMIT_PER_HOUR'], 15);
  const tickIndex = Math.floor(Date.now() / intervalMs);

  const connections = await prisma.nmsConnection.findMany({
    where: { status: 'connected' },
  });

  for (const connection of connections) {
    const meta: SampleMeta = { tenantId: connection.tenantId, connectionId: connection.id };

    let connector: INmsConnector;
    try {
      connector = buildConnectorFromConnection(connection).connector;
    } catch {
      // Skip unbuildable connections (e.g. decrypt failure, missing baseUrl).
      continue;
    }

    let onus: OnuSummary[];
    try {
      onus = await connector.listOnus();
    } catch {
      // Skip on bulk list failure — the rest of the connections still tick.
      continue;
    }

    const slice = pickFecFanOutSlice(onus, tickIndex, sliceSize);

    if (!fitsRateBudget(slice.length, intervalMs, limitPerHour)) {
      console.warn('[fec-collection] skipped', {
        tenantId: meta.tenantId,
        connectionId: meta.connectionId,
        reason: 'rate_limit',
        requested: slice.length,
        intervalMs,
        limitPerHour,
      });
      continue;
    }

    const sampledAt = new Date().toISOString();
    const t0 = Date.now();
    const settled = await mapAllSettled(slice, 4, (onu) => connector.getOnuDetail(onu.id));
    const points: MetricPoint[] = [];
    let contributedOnus = 0;
    for (const [i, r] of settled.entries()) {
      if (r.ok && r.value) {
        const perOnu = assembleOnuDetailPoints(meta, r.value, sampledAt);
        points.push(...perOnu);
        // An ONU that yielded ≥1 point is counted as `contributed`; both
        // fetch-rejected ONUs (mapAllSettled failure) and ONUs whose detail
        // has no FEC/optical fields (Mikrowisp AD-4 graceful no-op) end up
        // contributing zero rows, so both surface as `skipped` in the log so
        // dashboards can alert on connector-shape drift without conflating
        // the two failure modes at this layer.
        if (perOnu.length > 0) contributedOnus += 1;
      }
      // per-ONU failure swallowed — that ONU contributes zero rows
      // (REQ-4 / REQ-5 / spec kill-switch). `slice[i]` (the corresponding
      // OnuSummary) is intentionally not consumed here — the failure is
      // recorded only via the absent contribution count.
      void slice[i];
    }
    const { inserted } = await persistSamples(points);
    console.log('[fec-collection] tick', {
      tenantId: meta.tenantId,
      connectionId: meta.connectionId,
      requested: slice.length,
      persisted: inserted,
      skipped: slice.length - contributedOnus,
      durationMs: Date.now() - t0,
    });
  }
}

/**
 * Starts the FEC collection loop when FEC_COLLECTION_ENABLED=true. Mirrors the
 * shape of `startFirmwareAuditLoop` / `startPollingLoop`: registers a
 * `setInterval` and a one-shot 5s warm-up `setTimeout` so the first tick
 * happens shortly after boot. The returned disposer clears the interval; in-
 * flight ticks run to completion (kill switch only prevents NEW ticks).
 */
export function startFecCollectionLoop(): () => void {
  if (process.env['FEC_COLLECTION_ENABLED'] !== 'true') return () => {};

  const intervalMs = positiveInt(process.env['FEC_COLLECTION_INTERVAL_MS'], 3_600_000);
  const timer = setInterval(() => {
    runScheduledFecCollection().catch(() => {});
  }, intervalMs);

  // First run shortly after boot, without blocking startup.
  setTimeout(() => {
    runScheduledFecCollection().catch(() => {});
  }, 5000);

  return () => clearInterval(timer);
}
