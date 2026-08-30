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
}

export interface ReconcileResult {
  toUpsert: AlertRecord[];
  toNotify: AlertRecord[];
}

/**
 * Reconciles freshly detected findings against currently-open alerts.
 *
 * - New findings become open alerts and are notified immediately.
 * - Existing alerts refresh lastSeenAt and escalate severity (warning ->
 *   critical) but never downgrade.
 * - Repeat notifications only fire after the cooldown, or immediately on
 *   escalation.
 */
export function reconcile(
  findings: Finding[],
  existing: Map<string, AlertRecord>,
  meta: { tenantId: string; connectionId: string | null },
  opts: ReconcileOptions,
): ReconcileResult {
  const toUpsert: AlertRecord[] = [];
  const toNotify: AlertRecord[] = [];

  for (const finding of findings) {
    const key = findingKey(finding);
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

  return { toUpsert, toNotify };
}
