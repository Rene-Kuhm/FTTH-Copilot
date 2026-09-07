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
 * Single-flight guard for a recurring scheduled loop.
 *
 * Background (Fase F / monitoring contract):
 *
 * `setInterval(() => runScheduledX().catch(() => {}), intervalMs)` is the
 * original pattern. The callback is fire-and-forget — if the run takes
 * longer than `intervalMs`, the next interval tick fires while the
 * previous one is still in flight, and a second run starts in parallel.
 * With a slow NMS or a heavy FEC tick, that overlap compounds: two
 * pollers, two firmware audits, two FEC collectors all hammering the
 * NMS at the same time. Multi-instance deployments would each start
 * their own set of pollers, so the overlap multiplies by the number of
 * running instances.
 *
 * This helper tracks an in-flight flag per `name`. A tick that lands
 * while the previous run is still active is logged as a `skipped`
 * reason and not started. The in-flight flag is reset in `finally`,
 * so a thrown run never leaks the lock.
 *
 * Limitations (documented in the PR):
 *
 *   1. The lock is in-process. Two Node.js instances would each have
 *      their own. This is acceptable for the current single-instance
 *      production target; a Postgres advisory lock or a Redis SETNX
 *      is a future cross-instance solution.
 *
 *   2. The helper does not coalesce skipped ticks — they are simply
 *      dropped. The next legitimate run will be on the next interval
 *      boundary.
 *
 *   3. The returned disposer clears the interval AND the warm-up
 *      timeout, but cannot interrupt an in-flight tick (Node has no
 *      portable mechanism to cancel an in-progress async function
 *      without AbortController wiring). The in-flight tick runs to
 *      completion; only new ticks are prevented.
 *
 * For testing, the `isInFlight(name)` accessor lets tests observe the
 * in-flight state without racing the actual run.
 */
const IN_FLIGHT = new Map<string, boolean>();
const WARMUP_TIMEOUTS = new Map<string, ReturnType<typeof setTimeout>>();
const INTERVALS = new Map<string, ReturnType<typeof setInterval>>();

function isInFlight(name: string): boolean {
  return IN_FLIGHT.get(name) === true;
}

async function tryStart(name: string, runFn: () => Promise<unknown>): Promise<boolean> {
  if (IN_FLIGHT.get(name) === true) {
    console.warn('[scheduler] skipped overlapping tick', { name, reason: 'in_flight' });
    return false;
  }
  IN_FLIGHT.set(name, true);
  let ok = false;
  try {
    await runFn();
    ok = true;
  } catch (err) {
    // The original setInterval pattern swallowed errors via
    // `.catch(() => {})`. Preserve that behavior here so an in-flight
    // run that throws does not take down the timer.
    console.warn('[scheduler] tick threw', { name, error: (err as Error).message });
  } finally {
    IN_FLIGHT.set(name, false);
  }
  // ok=true means the run resolved cleanly; ok=false means it threw
  // (the warn above carries the error to the operator). A subsequent
  // tick is allowed in both cases because the in-flight flag has been
  // reset in `finally`.
  return ok;
}

/**
 * Testing-only helper: clears the in-flight and timer maps. Tests use
 * this in `beforeEach` to ensure each case starts from a clean slate.
 */
export function __clearSchedulerState(): void {
  for (const t of INTERVALS.values()) clearInterval(t);
  for (const t of WARMUP_TIMEOUTS.values()) clearTimeout(t);
  IN_FLIGHT.clear();
  INTERVALS.clear();
  WARMUP_TIMEOUTS.clear();
}

/**
 * Single-flight guard. Exported so tests can drive it directly
 * without pulling the entire `startPollingLoop` boot path (which
 * needs Prisma, the connector factory, and Telegram env vars).
 */
export { tryStart };

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
  const interval = setInterval(() => {
    void tryStart('polling', runScheduledPoll);
  }, intervalMs);
  INTERVALS.set('polling', interval);

  // First run shortly after boot, without blocking startup.
  const warmup = setTimeout(() => {
    void tryStart('polling', runScheduledPoll);
  }, 5000);
  WARMUP_TIMEOUTS.set('polling', warmup);

  return () => {
    clearInterval(interval);
    clearTimeout(warmup);
    INTERVALS.delete('polling');
    WARMUP_TIMEOUTS.delete('polling');
  };
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
  const interval = setInterval(() => {
    void tryStart('firmware', runScheduledFirmwareAudit);
  }, intervalMs);
  INTERVALS.set('firmware', interval);

  // First run shortly after boot, without blocking startup.
  const warmup = setTimeout(() => {
    void tryStart('firmware', runScheduledFirmwareAudit);
  }, 5000);
  WARMUP_TIMEOUTS.set('firmware', warmup);

  return () => {
    clearInterval(interval);
    clearTimeout(warmup);
    INTERVALS.delete('firmware');
    WARMUP_TIMEOUTS.delete('firmware');
  };
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
  const interval = setInterval(() => {
    void tryStart('fec', runScheduledFecCollection);
  }, intervalMs);
  INTERVALS.set('fec', interval);

  // First run shortly after boot, without blocking startup.
  const warmup = setTimeout(() => {
    void tryStart('fec', runScheduledFecCollection);
  }, 5000);
  WARMUP_TIMEOUTS.set('fec', warmup);

  return () => {
    clearInterval(interval);
    clearTimeout(warmup);
    INTERVALS.delete('fec');
    WARMUP_TIMEOUTS.delete('fec');
  };
}
