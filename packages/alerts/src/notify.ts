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

/**
 * Builds a Slack Block Kit payload with color sidebar attachments for high-visibility
 * NOC operational notifications.
 */
export function buildSlackPayload(records: AlertRecord[]): unknown {
  const hasCritical = records.some((r) => r.severity === 'critical');
  const themeColor = hasCritical ? '#E01E5A' : '#ECB22E';
  const headerIcon = hasCritical ? '🚨' : '⚠️';

  const blocks: unknown[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `${headerIcon} FTTH-Copilot — ${records.length} Alerta${records.length === 1 ? '' : 's'} Operativa${records.length === 1 ? '' : 's'}`,
        emoji: true,
      },
    },
  ];

  for (const r of records) {
    const icon = SEVERITY_ICON[r.severity];
    const etaText = r.etaMs ? `~${Math.round(r.etaMs / 60000)} min` : 'Inmediato / N/A';

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${icon} *${r.title}*\n${r.description}`,
      },
      fields: [
        {
          type: 'mrkdwn',
          text: `*Dispositivo:*\n\`${r.deviceKind} ${r.deviceId}\``,
        },
        {
          type: 'mrkdwn',
          text: `*Severidad:*\n*${r.severity.toUpperCase()}*`,
        },
        {
          type: 'mrkdwn',
          text: `*ETA Estimado:*\n${etaText}`,
        },
        {
          type: 'mrkdwn',
          text: `*Confianza:*\n${r.confidence ? `${Math.round(r.confidence * 100)}%` : 'N/A'}`,
        },
      ],
    });
    blocks.push({ type: 'divider' });
  }

  return {
    attachments: [
      {
        color: themeColor,
        blocks,
      },
    ],
  };
}

/**
 * Sends structured alerts to a Slack incoming webhook.
 */
export async function sendSlack(
  webhookUrl: string,
  recordsOrPayload: AlertRecord[] | unknown,
  fetchImpl: FetchLike = fetch,
): Promise<WebhookResult> {
  try {
    const payload = Array.isArray(recordsOrPayload)
      ? buildSlackPayload(recordsOrPayload as AlertRecord[])
      : recordsOrPayload;

    const res = await fetchImpl(webhookUrl, {
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

/**
 * Builds formatted text for WhatsApp with markdown markers (*bold*, _italic_, `code`).
 */
export function buildWhatsAppText(records: AlertRecord[]): string {
  const hasCritical = records.some((r) => r.severity === 'critical');
  const headerIcon = hasCritical ? '🚨' : '⚠️';

  const lines = records.map((r) => {
    const icon = SEVERITY_ICON[r.severity];
    const eta = r.etaMs ? ` (ETA: ~${Math.round(r.etaMs / 60000)}m)` : '';
    return `${icon} *[${r.deviceKind} ${r.deviceId}]* ${r.title}\n   _${r.description}_${eta}`;
  });

  return `${headerIcon} *FTTH-Copilot — Guardia NOC/SOC*\n_Detectadas ${records.length} alerta${records.length === 1 ? '' : 's'} en la red:_\n\n${lines.join('\n\n')}`;
}

/**
 * Builds JSON payload compatible with WhatsApp gateway APIs (Evolution API, Z-API, Cloud API).
 */
export function buildWhatsAppPayload(recipient: string, records: AlertRecord[]): unknown {
  const message = buildWhatsAppText(records);
  return {
    number: recipient,
    recipient,
    text: message,
    message,
  };
}

/**
 * Sends a notification via WhatsApp API gateway.
 */
export async function sendWhatsApp(
  apiUrl: string,
  recipient: string,
  recordsOrText: AlertRecord[] | string,
  apiKey?: string,
  fetchImpl: FetchLike = fetch,
): Promise<WebhookResult> {
  try {
    const text = typeof recordsOrText === 'string' ? recordsOrText : buildWhatsAppText(recordsOrText);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (apiKey) {
      headers['apikey'] = apiKey;
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const payload = {
      number: recipient,
      recipient,
      text,
      message: text,
    };

    const res = await fetchImpl(apiUrl, {
      method: 'POST',
      headers,
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
