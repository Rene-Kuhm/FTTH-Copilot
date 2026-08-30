import { prisma } from '@ftth-copilot/db';
import {
  detectBruteForce,
  detectAccessAfterFailures,
  detectConfigChange,
  type SecurityEvent,
  type SecurityFinding,
} from '@ftth-copilot/security';
import { sendWebhook, sendTelegram } from '@ftth-copilot/alerts';

export interface RunSecurityDetectionOptions {
  tenantId: string;
  connectionId?: string;
  now?: Date;
  /** How far back to read device events (also the detectors' window). */
  lookbackMs?: number;
  webhookUrl?: string;
  telegram?: { botToken: string; chatId: string };
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>;
}

export interface RunSecurityDetectionResult {
  events: number;
  bruteForce: number;
  accessAfterFailures: number;
  configChanges: number;
  /** Number of notification channels that reported success (0..2). */
  notified: number;
  error?: string;
}

const SEVERITY_ICON = { warning: '🟡', critical: '🔴' } as const;

export function buildSecurityPayload(findings: SecurityFinding[]): unknown {
  return {
    type: 'ftth-copilot.security',
    count: findings.length,
    findings: findings.map((f) => ({
      kind: f.kind,
      severity: f.severity,
      sourceIp: f.sourceIp,
      title: f.title,
      description: f.description,
      detectedAt: f.detectedAt,
    })),
  };
}

export function buildSecurityText(findings: SecurityFinding[]): string {
  const lines = findings.map(
    (f) => `${SEVERITY_ICON[f.severity]} [${f.sourceIp ?? 'desconocido'}] ${f.title}`,
  );
  return `FTTH-Copilot SOC — ${findings.length} hallazgo${findings.length === 1 ? '' : 's'}\n\n${lines.join('\n')}`;
}

/**
 * Loads recent device events for a tenant, runs the SOC detectors over them,
 * and notifies via webhook and/or Telegram when findings exist.
 */
export async function runSecurityDetection(
  opts: RunSecurityDetectionOptions,
): Promise<RunSecurityDetectionResult> {
  const now = opts.now ?? new Date();
  const lookbackMs = opts.lookbackMs ?? 15 * 60 * 1000;
  const since = new Date(now.getTime() - lookbackMs);

  const rows = await prisma.deviceEvent.findMany({
    where: {
      tenantId: opts.tenantId,
      ...(opts.connectionId ? { connectionId: opts.connectionId } : {}),
      occurredAt: { gte: since },
    },
    orderBy: { occurredAt: 'asc' },
    select: { category: true, sourceIp: true, message: true, occurredAt: true },
  });

  const events: SecurityEvent[] = rows.map((row) => ({
    t: row.occurredAt.getTime(),
    category: row.category as SecurityEvent['category'],
    sourceIp: row.sourceIp,
    message: row.message,
  }));

  const findings: SecurityFinding[] = [
    ...detectBruteForce(events, { now: now.getTime(), windowMs: lookbackMs }),
    ...detectAccessAfterFailures(events, { now: now.getTime(), windowMs: lookbackMs }),
    ...detectConfigChange(events, { now: now.getTime() }),
  ];

  let notified = 0;
  let error: string | undefined;

  if (findings.length > 0) {
    if (opts.webhookUrl) {
      const res = await sendWebhook(opts.webhookUrl, buildSecurityPayload(findings), opts.fetchImpl);
      if (res.ok) notified += 1;
      else error = res.error ?? `webhook ${res.status}`;
    }
    if (opts.telegram) {
      const res = await sendTelegram(
        opts.telegram.botToken,
        opts.telegram.chatId,
        buildSecurityText(findings),
        opts.fetchImpl,
      );
      if (res.ok) notified += 1;
      else error = error ?? res.error ?? `telegram ${res.status}`;
    }
  }

  return {
    events: events.length,
    bruteForce: findings.filter((f) => f.kind === 'brute_force').length,
    accessAfterFailures: findings.filter((f) => f.kind === 'access_after_failures').length,
    configChanges: findings.filter((f) => f.kind === 'config_change').length,
    notified,
    error,
  };
}
