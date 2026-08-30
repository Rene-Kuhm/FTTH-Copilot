import type { AlertRecord } from './types';

export interface WebhookResult {
  ok: boolean;
  status?: number;
  error?: string;
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/**
 * POSTs a JSON payload to a webhook URL. Never throws; returns a structured
 * result so callers can degrade gracefully.
 *
 * Trust boundary: `url` is operator-controlled config (ALERT_WEBHOOK_URL), not
 * tenant input. If it ever becomes per-tenant/user-configurable, this becomes
 * an SSRF surface and must go through the same network-policy validation as NMS
 * URLs.
 */
export async function sendWebhook(
  url: string,
  payload: unknown,
  fetchImpl: FetchLike = fetch,
): Promise<WebhookResult> {
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      return { ok: false, status: res.status, error: res.statusText };
    }
    return { ok: true, status: res.status };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown' };
  }
}

/** Builds the webhook payload for a batch of alerts. */
export function buildAlertPayload(records: AlertRecord[]): unknown {
  return {
    type: 'ftth-copilot.alerts',
    count: records.length,
    alerts: records.map((r) => ({
      id: r.id ?? null,
      kind: r.kind,
      severity: r.severity,
      deviceKind: r.deviceKind,
      deviceId: r.deviceId,
      title: r.title,
      description: r.description,
      etaMs: r.etaMs ?? null,
      confidence: r.confidence ?? null,
      detectedAt: r.lastSeenAt.toISOString(),
    })),
  };
}

const SEVERITY_ICON = { warning: '🟡', critical: '🔴' } as const;

/**
 * Builds a human-readable plain-text digest for Telegram. Telegram is a push
 * channel, so the message is kept short: one line per alert.
 */
export function buildAlertText(records: AlertRecord[]): string {
  const lines = records.map((r) => {
    const icon = SEVERITY_ICON[r.severity];
    return `${icon} [${r.deviceKind} ${r.deviceId}] ${r.title}`;
  });
  return `FTTH-Copilot — ${records.length} alerta${records.length === 1 ? '' : 's'}\n\n${lines.join('\n')}`;
}

/**
 * Sends a text message via the Telegram Bot API. Never throws; returns a
 * structured result.
 */
export async function sendTelegram(
  botToken: string,
  chatId: string,
  text: string,
  fetchImpl: FetchLike = fetch,
): Promise<WebhookResult> {
  try {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    if (!res.ok) {
      return { ok: false, status: res.status, error: res.statusText };
    }
    return { ok: true, status: res.status };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown' };
  }
}
