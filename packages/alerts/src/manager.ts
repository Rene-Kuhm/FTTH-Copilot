import { prisma } from '@ftth-copilot/db';
import { groupRows } from './group';
import { runDetectors } from './runner';
import { reconcile, findingKey } from './dedup';
import { correlateAlerts } from './correlate';
import { sendWebhook, buildAlertPayload, sendTelegram, buildAlertText } from './notify';
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
  /** Open alert with no matching finding for this long is marked resolved. */
  resolveAfterMs?: number;
  /** Open (unacknowledged) warning alert older than this is escalated to critical. */
  escalateAfterMs?: number;
  /** Webhook URL; when absent, no notification is sent. */
  webhookUrl?: string;
  /** Telegram bot config; when absent, no Telegram notification is sent. */
  telegram?: { botToken: string; chatId: string };
  /** Injectable fetch for webhook delivery (defaults to global fetch). */
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>;
}

export interface RunDetectionResult {
  detected: number;
  upserted: number;
  notified: number;
  telegramNotified: number;
  correlated: number;
  resolved: number;
  notificationError?: string;
  telegramError?: string;
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
    resolvedAt: r.resolvedAt ?? null,
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
    resolvedAt: r.resolvedAt ?? null,
  };
}

/**
 * Correlates the tenant/connection's active alerts into per-device incidents,
 * links alerts to their incident, and resolves incidents whose device no
 * longer has enough active alerts.
 */
async function correlateAndPersist(
  tenantId: string,
  connectionId: string,
  now: Date,
): Promise<{ correlated: number; resolved: number }> {
  const activeAlerts = await prisma.detectedAlert.findMany({
    where: { tenantId, connectionId, status: { in: ['open', 'acknowledged'] } },
    select: {
      tenantId: true,
      connectionId: true,
      kind: true,
      severity: true,
      deviceKind: true,
      deviceId: true,
      status: true,
      firstSeenAt: true,
      lastSeenAt: true,
    },
  });

  const incidents = correlateAlerts(activeAlerts as AlertRecord[], { now });

  const correlatedKeys = new Set<string>();
  let correlated = 0;
  for (const incident of incidents) {
    const upserted = await prisma.incident.upsert({
      where: {
        tenantId_connectionId_deviceKind_deviceId: {
          tenantId: incident.tenantId,
          connectionId,
          deviceKind: incident.deviceKind,
          deviceId: incident.deviceId,
        },
      },
      create: {
        tenantId: incident.tenantId,
        connectionId: incident.connectionId,
        deviceKind: incident.deviceKind,
        deviceId: incident.deviceId,
        title: incident.title,
        description: incident.description,
        severity: incident.severity,
        status: incident.status,
        firstSeenAt: incident.firstSeenAt,
        lastSeenAt: incident.lastSeenAt,
        resolvedAt: incident.resolvedAt ?? null,
      },
      update: {
        severity: incident.severity,
        title: incident.title,
        description: incident.description,
        status: incident.status,
        lastSeenAt: incident.lastSeenAt,
        resolvedAt: incident.resolvedAt ?? null,
      },
      select: { id: true },
    });

    correlatedKeys.add(`${incident.deviceKind}:${incident.deviceId}`);
    correlated++;
    await prisma.detectedAlert.updateMany({
      where: {
        tenantId,
        connectionId,
        deviceKind: incident.deviceKind,
        deviceId: incident.deviceId,
        status: { in: ['open', 'acknowledged'] },
      },
      data: { incidentId: upserted.id },
    });
  }

  // Resolve incidents whose device no longer has enough active alerts.
  const existingIncidents = await prisma.incident.findMany({
    where: { tenantId, connectionId, status: { in: ['open', 'acknowledged'] } },
    select: { id: true, deviceKind: true, deviceId: true },
  });
  let resolved = 0;
  for (const incident of existingIncidents) {
    if (correlatedKeys.has(`${incident.deviceKind}:${incident.deviceId}`)) continue;
    await prisma.incident.updateMany({
      where: { id: incident.id, status: { in: ['open', 'acknowledged'] } },
      data: { status: 'resolved', resolvedAt: now },
    });
    resolved++;
  }

  return { correlated, resolved };
}

/**
 * End-to-end detection run for a tenant connection: read recent samples, group
 * them per device, run the detectors, reconcile against open alerts (dedup /
 * cooldown / escalation), persist, notify via webhook, and correlate incidents.
 */
export async function runDetection(opts: RunDetectionOptions): Promise<RunDetectionResult> {
  const now = opts.now ?? new Date();
  const lookbackMs = opts.lookbackMs ?? 14 * DAY_MS;
  const cooldownMs = opts.cooldownMs ?? 60 * 60 * 1000;
  const resolveAfterMs = opts.resolveAfterMs ?? 24 * DAY_MS;
  const escalateAfterMs = opts.escalateAfterMs ?? 4 * 60 * 60 * 1000;
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
    where: {
      tenantId: opts.tenantId,
      connectionId: opts.connectionId,
      status: { in: ['open', 'acknowledged'] },
    },
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
      resolvedAt: true,
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
    { now, cooldownMs, resolveAfterMs, escalateAfterMs },
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

  let telegramNotified = 0;
  let telegramError: string | undefined;
  if (opts.telegram && toNotify.length > 0) {
    const result = await sendTelegram(
      opts.telegram.botToken,
      opts.telegram.chatId,
      buildAlertText(toNotify),
      opts.fetchImpl,
    );
    if (result.ok) telegramNotified = toNotify.length;
    else telegramError = result.error ?? `HTTP ${result.status}`;
  }

  const { correlated, resolved } = await correlateAndPersist(
    opts.tenantId,
    opts.connectionId,
    now,
  );

  return {
    detected: findings.length,
    upserted,
    notified,
    telegramNotified,
    correlated,
    resolved,
    notificationError,
    telegramError,
  };
}
