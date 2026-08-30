import type { Finding } from '@ftth-copilot/detection';
import type { AlertRecord } from './types';

const SEVERITY_ORDER = { warning: 0, critical: 1 } as const;

const DEFAULT_RESOLVE_AFTER_MS = 24 * 60 * 60 * 1000;
const DEFAULT_ESCALATE_AFTER_MS = 4 * 60 * 60 * 1000;

export function findingKey(f: { kind: string; deviceKind: string; deviceId: string }): string {
  return `${f.kind}:${f.deviceKind}:${f.deviceId}`;
}

export interface ReconcileOptions {
  now: Date;
  /** Minimum time between notifications for the same alert. */
  cooldownMs: number;
  /** Open alert with no matching finding for this long is marked resolved. */
  resolveAfterMs?: number;
  /** Open (unacknowledged) warning alert older than this is escalated to critical. */
  escalateAfterMs?: number;
}

export interface ReconcileResult {
  toUpsert: AlertRecord[];
  toNotify: AlertRecord[];
}

function cooldownElapsed(alert: AlertRecord, now: Date, cooldownMs: number): boolean {
  return (
    alert.lastNotifiedAt === null ||
    now.getTime() - alert.lastNotifiedAt.getTime() >= cooldownMs
  );
}

function isStale(alert: AlertRecord, now: Date, resolveAfterMs: number): boolean {
  return now.getTime() - alert.lastSeenAt.getTime() >= resolveAfterMs;
}

function isEscalatable(alert: AlertRecord, now: Date, escalateAfterMs: number): boolean {
  return (
    alert.severity === 'warning' &&
    now.getTime() - alert.firstSeenAt.getTime() >= escalateAfterMs
  );
}

/**
 * Reconciles freshly detected findings against currently-active alerts.
 *
 * Lifecycle:
 * - New findings become open alerts and are notified immediately.
 * - A matched open alert refreshes lastSeenAt and escalates severity (from a
 *   critical finding, or by age) but never downgrades; it notifies on
 *   escalation or cooldown.
 * - A matched acknowledged alert stays acknowledged (ack is never lost) and
 *   only refreshes lastSeenAt.
 * - An unmatched alert whose finding stopped is resolved after `resolveAfterMs`
 *   of staleness.
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
  const escalateAfterMs = opts.escalateAfterMs ?? DEFAULT_ESCALATE_AFTER_MS;
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

    if (prior.status === 'acknowledged') {
      toUpsert.push({ ...prior, lastSeenAt: opts.now });
      continue;
    }

    // prior.status === 'open'
    const findingEscalated = SEVERITY_ORDER[finding.severity] > SEVERITY_ORDER[prior.severity];
    const ageEscalated = isEscalatable(prior, opts.now, escalateAfterMs);
    const base: AlertRecord = {
      ...prior,
      severity: findingEscalated || ageEscalated ? 'critical' : prior.severity,
      title: finding.title,
      description: finding.description,
      etaMs: finding.etaMs ?? prior.etaMs ?? null,
      confidence: finding.confidence ?? prior.confidence ?? null,
      status: 'open',
      lastSeenAt: opts.now,
      resolvedAt: null,
    };

    const notify =
      findingEscalated || ageEscalated || cooldownElapsed(prior, opts.now, opts.cooldownMs);

    if (notify) {
      const record: AlertRecord = { ...base, lastNotifiedAt: opts.now };
      toUpsert.push(record);
      toNotify.push(record);
    } else {
      toUpsert.push(base);
    }
  }

  // Unmatched active alerts: resolve when stale; otherwise leave unchanged
  // (still within the grace period before resolution — no escalation, since
  // the finding stopped).
  for (const [key, alert] of existing) {
    if (matched.has(key)) continue;

    if (isStale(alert, opts.now, resolveAfterMs)) {
      toUpsert.push({ ...alert, status: 'resolved', resolvedAt: opts.now });
    }
  }

  return { toUpsert, toNotify };
}
