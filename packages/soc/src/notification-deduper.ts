import { createHash } from 'node:crypto';

/**
 * In-memory notification dedupe with TTL.
 *
 * Background (Fase F / SOC contract):
 *
 * `runSecurityDetection` reads the last `lookbackMs` (default 15 min)
 * of device events on every tick and notifies for every finding it
 * produces. The SOC scheduler (`apps/web/lib/monitoring/syslog.ts`)
 * fires the detection pass every `SYSLOG_DETECTION_INTERVAL_MS`
 * (default 60s), so a single config-change event is re-detected and
 * re-notified on every tick for the entire lookback window — the
 * operator's Telegram ends up flooded with the same alert once per
 * minute until the event ages out.
 *
 * The dedupe here is a fingerprint-keyed TTL cache. On `notifyOnce`:
 *   - if the fingerprint is in the cache AND its age is `<= cooldownMs`
 *     (inclusive), the sendFn is NOT called and the function returns
 *     `{ sent: false, skipped: true }`;
 *   - otherwise, sendFn is called; on `sendOk === true` the fingerprint
 *     is recorded with the current timestamp and the function returns
 *     `{ sent: true }`. On `sendOk === false` the fingerprint is NOT
 *     recorded so a transient failure does not consume the cooldown.
 *
 * Limitations (documented in the PR):
 *
 *   1. The cache is in-memory and does NOT survive a process restart.
 *      The original bug is "notify every minute within the lookback
 *      window" — both are well inside a single process lifetime, so
 *      this still resolves the reported symptom.
 *
 *   2. Multi-instance deployments would each maintain their own
 *      cache. Acceptable for the current single-instance production
 *      target.
 *
 *   3. Cache entries are pruned lazily on each `notifyOnce` call
 *      (entries older than the cooldown window are dropped).
 */

/**
 * Stable fingerprint for a notification. Concatenates the relevant
 * fields into a JSON string and hashes them to a fixed-length hex
 * digest. The result is suitable as a Map key.
 */
export function notificationFingerprint(parts: {
  tenantId: string;
  connectionId?: string | null;
  /** Includes a per-channel discriminator ('webhook' / 'telegram') so
   * the two channels don't share a cooldown slot. */
  channel: 'webhook' | 'telegram';
  kind: string;
  sourceIp?: string | null;
  severity: string;
  title: string;
}): string {
  const ordered: Record<string, string> = {
    tenantId: parts.tenantId,
    connectionId: parts.connectionId ?? '',
    channel: parts.channel,
    kind: parts.kind,
    sourceIp: parts.sourceIp ?? '',
    severity: parts.severity,
    title: parts.title,
  };
  return createHash('sha256').update(JSON.stringify(ordered)).digest('hex').slice(0, 16);
}

interface CacheEntry {
  ts: number; // epoch ms when last sent
}

export interface NotifyOnceResult {
  /** True when sendFn was called and returned sendOk === true. */
  sent: boolean;
  /** True when the call was skipped because the fingerprint was still in cooldown. */
  skipped?: boolean;
  /** The sendFn's `error` when it was called but reported failure. */
  error?: string;
  /** The fingerprint that was checked. */
  fingerprint: string;
}

export interface NotifyOnceSendResult {
  ok: boolean;
  error?: string;
}

/**
 * Calls `sendFn` at most once per (fingerprint, cooldownMs) window.
 *
 * Boundary: the cooldown is INCLUSIVE — a fingerprint whose age is
 * exactly cooldownMs is still considered inside its cooldown and the
 * send is skipped. `now - ts <= cooldownMs` is the guard.
 *
 * Returns:
 *   - `{ sent: true, fingerprint }` when sendFn ran and returned
 *     `{ ok: true }`.
 *   - `{ sent: false, skipped: true, fingerprint }` when the fingerprint
 *     was still in cooldown and the call was skipped (sendFn NOT
 *     invoked).
 *   - `{ sent: false, error, fingerprint }` when sendFn was called but
 *     returned `{ ok: false, error }`. The fingerprint is NOT recorded,
 *     so the next call within the cooldown will retry.
 */
export function notifyOnce(
  cache: Map<string, CacheEntry>,
  parts: Parameters<typeof notificationFingerprint>[0],
  cooldownMs: number,
  sendFn: () => Promise<NotifyOnceSendResult>,
  now: number = Date.now(),
): Promise<NotifyOnceResult> {
  const fingerprint = notificationFingerprint(parts);
  const existing = cache.get(fingerprint);
  if (existing !== undefined && now - existing.ts <= cooldownMs) {
    return Promise.resolve({ sent: false, skipped: true, fingerprint });
  }
  return sendFn().then((r) => {
    if (r.ok) {
      cache.set(fingerprint, { ts: now });
      pruneCache(cache, now, cooldownMs);
      return { sent: true, fingerprint } as NotifyOnceResult;
    }
    // Failed send: do NOT consume the cooldown, but still prune stale entries.
    pruneCache(cache, now, cooldownMs);
    return { sent: false, error: r.error, fingerprint } as NotifyOnceResult;
  });
}

/**
 * Drops entries older than the cooldown window. Anything older cannot
 * still be inside a cooldown check (the guard is `now - ts <= cooldownMs`),
 * so dropping them bounds memory at O(unique fingerprints seen within
 * the cooldown).
 */
function pruneCache(cache: Map<string, CacheEntry>, now: number, cooldownMs: number): void {
  const cutoff = now - cooldownMs;
  for (const [key, entry] of cache) {
    if (entry.ts < cutoff) cache.delete(key);
  }
}

/**
 * Testing-only helper: clears every entry from the given cache map.
 *
 * The module-level `NOTIFY_CACHE` in `run.ts` survives across tests
 * in the same vitest worker, which means a test that runs after one
 * that already notified may see the notification as a "skip" instead
 * of an actual send. Tests that exercise `runSecurityDetection`'s
 * notification path must call this helper in their `beforeEach` to
 * reset the cache between cases.
 */
export function __clearNotifyCache(cache: Map<string, CacheEntry>): void {
  cache.clear();
}
