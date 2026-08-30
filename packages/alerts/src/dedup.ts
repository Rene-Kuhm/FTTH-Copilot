import type { Finding } from '@ftth-copilot/detection';
import type { AlertRecord } from './types';

const SEVERITY_ORDER = { warning: 0, critical: 1 } as const;

export function findingKey(f: { kind: string; deviceKind: string; deviceId: string }): string {
  return `${f.kind}:${f.deviceKind}:${f.deviceId}`;
}

export interface ReconcileOptions {
  now: Date;
  /** Minimum time between notifications for the same alert. */
  cooldownMs: number;
  /** Open alert with no matching finding for this long is marked resolved. */
  resolveAfterMs?: number;
}

export interface ReconcileResult {
  toUpsert: AlertRecord[];
  toNotify: AlertRecord[];
}

const DEFAULT_RESOLVE_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * Reconciles freshly detected findings against currently-open alerts.
 *
 * - New findings become open alerts and are notified immediately.
 * - Existing alerts refresh lastSeenAt and escalate severity (warning ->
 *   critical) but never downgrade.
 * - Repeat notifications only fire after the cooldown, or immediately on
 *   escalation.
 * - An open alert whose finding stopped appearing is marked resolved once it
 *   has been stale for at least `resolveAfterMs` (grace period survives
 *   restarts because it is time-based, not cycle-count-based).
 */
export function reconcile(
  findings: Finding[],
  existing: Map<string, AlertRecord>,
  meta: { tenantId: string; connectionId: string | null },
  opts: ReconcileOptions,
): ReconcileResult {
  const toUpsert: AlertRecord[] = [];
  const toNotify: AlertRecord[] = [];
  const resolveAfterMs = opts.resolveAfterMs ?? DEFAULT_RESOLVE_AFTER_MS;
  const matched = new Set<string>();

  for (const finding of findings) {
    const key = findingKey(finding);
    matched.add(key);
    const prior = existing.get(key);

    if (!prior) {
      const record: AlertRecord = {
        tenantId: meta.tenantId,
        connectionId: meta.connectionId,
        kind: finding.kind,
        severity: finding.severity,
        deviceKind: finding.deviceKind,
        deviceId: finding.deviceId,
        title: finding.title,
        description: finding.description,
        etaMs: finding.etaMs ?? null,
        confidence: finding.confidence ?? null,
        status: 'open',
        firstSeenAt: opts.now,
        lastSeenAt: opts.now,
        lastNotifiedAt: opts.now,
        resolvedAt: null,
      };
      toUpsert.push(record);
      toNotify.push(record);
      continue;
    }

    const escalated = SEVERITY_ORDER[finding.severity] > SEVERITY_ORDER[prior.severity];
    const base: AlertRecord = {
      ...prior,
      severity: escalated ? finding.severity : prior.severity,
      title: finding.title,
      description: finding.description,
      etaMs: finding.etaMs ?? prior.etaMs ?? null,
      confidence: finding.confidence ?? prior.confidence ?? null,
      status: 'open',
      lastSeenAt: opts.now,
      resolvedAt: null,
    };

    const cooldownElapsed =
      prior.lastNotifiedAt === null ||
      opts.now.getTime() - prior.lastNotifiedAt.getTime() >= opts.cooldownMs;

    if (escalated || cooldownElapsed) {
      const record: AlertRecord = { ...base, lastNotifiedAt: opts.now };
      toUpsert.push(record);
      toNotify.push(record);
    } else {
      toUpsert.push(base);
    }
  }

  // Resolve open alerts whose finding did not appear this run.
  for (const [key, alert] of existing) {
    if (matched.has(key)) continue;
    if (alert.status !== 'open') continue;
    const staleFor = opts.now.getTime() - alert.lastSeenAt.getTime();
    if (staleFor < resolveAfterMs) continue;

    toUpsert.push({
      ...alert,
      status: 'resolved',
      resolvedAt: opts.now,
    });
  }

  return { toUpsert, toNotify };
}
