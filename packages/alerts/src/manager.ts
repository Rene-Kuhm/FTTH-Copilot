import { prisma } from '@ftth-copilot/db';
import { groupRows } from './group';
import { runDetectors } from './runner';
import { reconcile, findingKey } from './dedup';
import { sendWebhook, buildAlertPayload } from './notify';
import type { AlertRecord, MetricRow } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface RunDetectionOptions {
  tenantId: string;
  connectionId: string;
  now?: Date;
  /** How far back to read metric samples. */
  lookbackMs?: number;
  /** Minimum interval between repeated notifications for the same alert. */
  cooldownMs?: number;
  /** Webhook URL; when absent, no notification is sent. */
  webhookUrl?: string;
  /** Injectable fetch for webhook delivery (defaults to global fetch). */
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>;
}

export interface RunDetectionResult {
  detected: number;
  upserted: number;
  notified: number;
  notificationError?: string;
}

function toCreateData(r: AlertRecord) {
  return {
    tenantId: r.tenantId,
    connectionId: r.connectionId,
    kind: r.kind,
    severity: r.severity,
    deviceKind: r.deviceKind,
    deviceId: r.deviceId,
    title: r.title,
    description: r.description,
    etaMs: r.etaMs ?? null,
    confidence: r.confidence ?? null,
    status: r.status,
    firstSeenAt: r.firstSeenAt,
    lastSeenAt: r.lastSeenAt,
    lastNotifiedAt: r.lastNotifiedAt,
  };
}

function toUpdateData(r: AlertRecord) {
  return {
    severity: r.severity,
    title: r.title,
    description: r.description,
    etaMs: r.etaMs ?? null,
    confidence: r.confidence ?? null,
    status: r.status,
    lastSeenAt: r.lastSeenAt,
    lastNotifiedAt: r.lastNotifiedAt,
  };
}

/**
 * End-to-end detection run for a tenant connection: read recent samples, group
 * them per device, run the detectors, reconcile against open alerts (dedup /
 * cooldown / escalation), persist, and notify via webhook.
 */
export async function runDetection(opts: RunDetectionOptions): Promise<RunDetectionResult> {
  const now = opts.now ?? new Date();
  const lookbackMs = opts.lookbackMs ?? 14 * DAY_MS;
  const cooldownMs = opts.cooldownMs ?? 60 * 60 * 1000;
  const since = new Date(now.getTime() - lookbackMs);

  const samples = await prisma.metricSample.findMany({
    where: {
      tenantId: opts.tenantId,
      connectionId: opts.connectionId,
      sampledAt: { gte: since },
    },
    orderBy: { sampledAt: 'asc' },
    select: {
      deviceKind: true,
      deviceId: true,
      kind: true,
      value: true,
      valueText: true,
      sampledAt: true,
    },
  });

  const series = groupRows(samples as MetricRow[]);
  const findings = runDetectors(series, { now: now.getTime() });

  const existingRows = await prisma.detectedAlert.findMany({
    where: { tenantId: opts.tenantId, connectionId: opts.connectionId, status: 'open' },
    select: {
      id: true,
      tenantId: true,
      connectionId: true,
      kind: true,
      severity: true,
      deviceKind: true,
      deviceId: true,
      title: true,
      description: true,
      etaMs: true,
      confidence: true,
      status: true,
      firstSeenAt: true,
      lastSeenAt: true,
      lastNotifiedAt: true,
    },
  });

  const existing = new Map<string, AlertRecord>();
  for (const row of existingRows) {
    existing.set(findingKey(row), row as AlertRecord);
  }

  const { toUpsert, toNotify } = reconcile(
    findings,
    existing,
    { tenantId: opts.tenantId, connectionId: opts.connectionId },
    { now, cooldownMs },
  );

  let upserted = 0;
  for (const record of toUpsert) {
    await prisma.detectedAlert.upsert({
      where: {
        tenantId_connectionId_kind_deviceKind_deviceId: {
          tenantId: record.tenantId,
          connectionId: opts.connectionId,
          kind: record.kind,
          deviceKind: record.deviceKind,
          deviceId: record.deviceId,
        },
      },
      create: toCreateData(record),
      update: toUpdateData(record),
    });
    upserted++;
  }

  let notified = 0;
  let notificationError: string | undefined;
  if (opts.webhookUrl && toNotify.length > 0) {
    const result = await sendWebhook(opts.webhookUrl, buildAlertPayload(toNotify), opts.fetchImpl);
    if (result.ok) notified = toNotify.length;
    else notificationError = result.error ?? `HTTP ${result.status}`;
  }

  return { detected: findings.length, upserted, notified, notificationError };
}
