import { prisma } from '@ftth-copilot/db';
import type { INmsConnector } from '@ftth-copilot/connectors-core';
import {
  detectBruteForce,
  detectAccessAfterFailures,
  detectConfigChange,
  detectVulnerableFirmware,
  type SecurityEvent,
  type SecurityFinding,
  type DeviceFirmware,
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

export interface RunFirmwareAuditOptions {
  tenantId: string;
  connectionId: string;
  /** Connector used to read live firmware versions. */
  connector: INmsConnector;
  /**
   * Whether to fan out to getOnuDetail() per ONU. The bulk listOnus() often
   * does not include firmware; the per-device endpoint usually does. When
   * false, the audit only sees devices whose bulk response carries a
   * firmware version.
   */
  includeOnuDetail?: boolean;
  /** Allowlist of known-vulnerable firmware versions to flag. */
  vulnerable: string[];
  /** Max concurrent per-ONU detail requests when includeOnuDetail is true. */
  onuDetailConcurrency?: number;
  now?: Date;
  webhookUrl?: string;
  telegram?: { botToken: string; chatId: string };
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>;
}

export interface RunFirmwareAuditResult {
  devicesScanned: number;
  vulnerable: number;
  /** Number of notification channels that reported success (0..2). */
  notified: number;
  error?: string;
}

/**
 * Default allowlist of firmware versions known to be vulnerable. The list is
 * intentionally small and explicit — every entry must correspond to a real
 * advisory. Pass a longer list via `opts.vulnerable` when running with a
 * custom CVE feed.
 */
export const DEFAULT_VULNERABLE_FIRMWARE: readonly string[] = [
  // Huawei HG8145V5 — V3R019C10S135 ships a known-OMCI authentication bypass.
  'V3R019C10S135',
];

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

/**
 * Reads live firmware versions from the connector (with optional per-ONU
 * fan-out), runs `detectVulnerableFirmware`, and notifies via webhook and/or
 * Telegram when at least one device matches the vulnerable allowlist.
 *
 * Per-ONU detail failures are swallowed so a single device failure cannot
 * drop the whole audit.
 */
export async function runFirmwareAudit(
  opts: RunFirmwareAuditOptions,
): Promise<RunFirmwareAuditResult> {
  const now = opts.now ?? new Date();
  const concurrency = Math.max(1, opts.onuDetailConcurrency ?? 4);

  const summaries = await opts.connector.listOnus();
  const firmwareMap = new Map<string, string | undefined>();

  // Seed with whatever the bulk response provided (some NMSs include it).
  for (const s of summaries) {
    firmwareMap.set(s.id, undefined);
  }

  if (opts.includeOnuDetail && summaries.length > 0) {
    const settled = await mapWithConcurrency(
      summaries,
      concurrency,
      async (onu) => {
        try {
          return await opts.connector.getOnuDetail(onu.id);
        } catch {
          return null;
        }
      },
    );
    for (let i = 0; i < summaries.length; i++) {
      const onu = summaries[i]!;
      const detail = settled[i] ?? null;
      if (detail?.firmwareVersion) firmwareMap.set(onu.id, detail.firmwareVersion);
    }
  }

  const devices: DeviceFirmware[] = summaries.map((onu) => ({
    deviceKind: 'ONU',
    deviceId: onu.id,
    firmwareVersion: firmwareMap.get(onu.id) ?? null,
  }));

  const findings = detectVulnerableFirmware(devices, [...opts.vulnerable], { now: now.getTime() });

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
    devicesScanned: devices.length,
    vulnerable: findings.length,
    notified,
    error,
  };
}

/**
 * Bounded-concurrency map for the firmware audit's optional per-ONU fan-out.
 * Returns `null` for any element whose worker threw, so the caller can keep
 * scanning the rest of the batch.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<Array<R | null>> {
  const results: Array<R | null> = new Array(items.length);
  let nextIndex = 0;
  const limit = Math.max(1, concurrency);
  const workers = Array.from({ length: limit }, async () => {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length) return;
      try {
        results[i] = await fn(items[i]!, i);
      } catch {
        results[i] = null;
      }
    }
  });
  await Promise.all(workers);
  return results;
}
