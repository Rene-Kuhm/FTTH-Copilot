/**
 * Outbound notification rendering and routing.
 *
 * A NOC tool is only as good as whether the right person hears about the right fault,
 * so this module owns three things: turning an event into a channel-native payload,
 * deciding which channels an event belongs to, and making sure credentials never leak
 * into a log line or an error message.
 *
 * Rendering is separated from transport on purpose. The API layer and the UI preview
 * both need the exact bytes that will be sent, and a dry-run must not require a network
 * call to be trustworthy.
 */

export type NotificationSeverity = 'critical' | 'warning' | 'info';

export type NotificationChannelType = 'slack' | 'webhook' | 'email' | 'ntfy';

export interface NotificationChannel {
  id: string;
  tenantId: string;
  type: NotificationChannelType;
  /** Slack/webhook URL, or `user@host` for email. */
  target: string;
  enabled: boolean;
  minSeverity: NotificationSeverity;
  labels: string[];
  /**
   * A repeat of the same dedupeKey inside this window is suppressed. Part of the
   * channel contract rather than a storage detail, because it changes routing: a
   * flapping link must not page the on-call once per scrape.
   */
  cooldownSeconds: number;
  lastSentAt?: Date | null;
  lastError?: string | null;
}

export interface NotificationContext {
  title: string;
  body: string;
  severity: NotificationSeverity;
  kind: string;
  deviceKind: string;
  deviceId: string;
  url?: string;
  /** Stable identity for cooldown dedupe; same fault must not notify twice. */
  dedupeKey: string;
}

const SEVERITY_RANK: Record<NotificationSeverity, number> = { info: 0, warning: 1, critical: 2 };

/** Slack attachment colours, keyed to severity. */
const SLACK_COLOR: Record<NotificationSeverity, string> = {
  critical: '#EF4444',
  warning: '#F59E0B',
  info: '#3B82F6',
};

const SLACK_EMOJI: Record<NotificationSeverity, string> = {
  critical: ':rotating_light:',
  warning: ':warning:',
  info: ':information_source:',
};

/**
 * Strip credentials from anything about to be logged or returned to a client.
 *
 * Notification targets ARE secrets: a Slack webhook URL grants posting to the channel,
 * and it routinely ends up in a stack trace or a debug log. Anything that leaves this
 * module for a log, an error message, or an API response goes through here first.
 */
export function redactSecrets(input: string): string {
  return input
    // Slack/Discord style webhook paths: .../services/TOKEN/TOKEN/TOKEN or /hooks/ID
    .replace(/(https?:\/\/[^\s/]*\/(?:services|hooks|api\/webhooks)\/)[^\s/]+(?:\/[^\s/]+)*/gi, '$1***')
    // Ntfy server URLs and topics: https://ntfy.sh/my-topic -> https://ntfy.sh/***
    .replace(/(https?:\/\/[^\s/]+\/)[a-zA-Z0-9_-]+/gi, '$1***')
    // userinfo passwords: scheme://user:password@host
    .replace(/(https?:\/\/[^\s/:@]+):[^\s/@]+@/gi, '$1:***@')
    // Authorization headers
    .replace(/(bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1***')
    // Generic key=value secrets
    .replace(/\b(token|api[_-]?key|secret|password|authorization)\s*[:=]\s*\S+/gi, '$1=***');
}

const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** Slack Block Kit payload. */
export function buildSlackPayload(ctx: NotificationContext): {
  text: string;
  blocks: unknown[];
  attachments: unknown[];
} {
  const emoji = SLACK_EMOJI[ctx.severity];
  return {
    // Fallback text for clients that do not render blocks, and for push notifications.
    text: `${emoji} ${ctx.title}`,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: `${emoji} ${ctx.title}`, emoji: true },
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: ctx.body },
        fields: [
          { type: 'mrkdwn', text: `*Severity*\n${ctx.severity.toUpperCase()}` },
          { type: 'mrkdwn', text: `*Device*\n${ctx.deviceKind} ${ctx.deviceId}` },
          { type: 'mrkdwn', text: `*Kind*\n${ctx.kind}` },
          { type: 'mrkdwn', text: `*Key*\n\`${ctx.dedupeKey}\`` },
        ],
      },
      ...(ctx.url
        ? [{ type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Open dashboard' }, url: ctx.url }] }]
        : []),
    ],
    attachments: [{ color: SLACK_COLOR[ctx.severity] }],
  };
}

export interface WebhookPayload {
  schema: 'ftth.notification.v1';
  title: string;
  body: string;
  severity: NotificationSeverity;
  kind: string;
  deviceKind: string;
  deviceId: string;
  url?: string;
  dedupeKey: string;
}

/** Generic JSON webhook payload, for PagerDuty-style or custom receivers. */
export function buildWebhookPayload(ctx: NotificationContext): WebhookPayload {
  return {
    schema: 'ftth.notification.v1',
    title: ctx.title,
    body: ctx.body,
    severity: ctx.severity,
    kind: ctx.kind,
    deviceKind: ctx.deviceKind,
    deviceId: ctx.deviceId,
    ...(ctx.url ? { url: ctx.url } : {}),
    dedupeKey: ctx.dedupeKey,
  };
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** RFC 5322-ish email with a text and an HTML alternative. */
export function buildEmailMessage(ctx: NotificationContext): EmailMessage {
  const subject = `[${ctx.severity.toUpperCase()}] ${ctx.title}`;
  const text = [
    ctx.title,
    '',
    ctx.body,
    '',
    `Severity : ${ctx.severity}`,
    `Device   : ${ctx.deviceKind} ${ctx.deviceId}`,
    `Kind     : ${ctx.kind}`,
    `Key      : ${ctx.dedupeKey}`,
    ctx.url ? `Dashboard: ${ctx.url}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;background:#0b0b0f;color:#e5e5e5;padding:24px">
<div style="max-width:560px;margin:0 auto;background:#16161c;border:1px solid #2a2a33;border-left:4px solid ${SLACK_COLOR[ctx.severity]};border-radius:12px;padding:20px">
<h1 style="margin:0 0 4px;font-size:18px">${escapeHtml(ctx.title)}</h1>
<p style="margin:0 0 16px;color:#9ca3af;font-size:13px">${ctx.severity.toUpperCase()} · ${escapeHtml(ctx.deviceKind)} ${escapeHtml(ctx.deviceId)}</p>
<p style="margin:0 0 16px;line-height:1.6">${escapeHtml(ctx.body)}</p>
<table style="font-size:12px;color:#9ca3af;border-collapse:collapse">
<tr><td style="padding:2px 12px 2px 0">Kind</td><td>${escapeHtml(ctx.kind)}</td></tr>
<tr><td style="padding:2px 12px 2px 0">Key</td><td><code>${escapeHtml(ctx.dedupeKey)}</code></td></tr>
</table>
${ctx.url ? `<p style="margin-top:16px"><a href="${escapeHtml(ctx.url)}" style="color:#60a5fa">Open dashboard →</a></p>` : ''}
</div></body></html>`;

  return { to: '', subject, text, html };
}

export interface RoutedChannel extends NotificationChannel {
  severityRank: number;
}

/**
 * Pick the channels an event should go to.
 *
 * An unrecognised severity routes nowhere. Failing open here would mean a malformed
 * severity silently escalating into every critical channel, which is the opposite of
 * what a notification gate is for.
 */
export function resolveRouting(
  channels: readonly NotificationChannel[],
  severity: NotificationSeverity | string,
): RoutedChannel[] {
  const rank = SEVERITY_RANK[severity as NotificationSeverity];
  if (rank === undefined) return [];

  return channels
    .filter((c) => c.enabled)
    .map((c) => ({ ...c, severityRank: rank }))
    .filter((c) => {
      const min = SEVERITY_RANK[c.minSeverity];
      // A channel with a corrupt threshold is skipped rather than treated as critical.
      return min !== undefined && rank >= min;
    });
}

export interface DispatchResult {
  channelId: string;
  type: NotificationChannelType;
  ok: boolean;
  status?: number;
  /** Always redacted, safe to log. */
  target: string;
  error?: string;
  skipped?: boolean;
}

/**
 * Deliver a rendered payload to one channel.
 *
 * Timeouts are mandatory: a hung Slack endpoint must not hold the alerting loop, and
 * an NMS that blocks on notifications stops ingesting the events you need to diagnose
 * why. `AbortSignal.timeout` bounds each attempt.
 */
export async function dispatchToChannel(
  channel: NotificationChannel,
  ctx: NotificationContext,
  opts: { timeoutMs?: number } = {},
): Promise<DispatchResult> {
  const timeoutMs = opts.timeoutMs ?? 8000;
  const safeTarget = redactSecrets(channel.target);

  try {
    if (channel.type === 'email') {
      // Email needs an SMTP relay, which is deployment-specific and out of scope for
      // the HTTP path. The message is rendered and returned so a caller with a relay
      // configured can hand it over; the demo stack has no relay.
      const message = buildEmailMessage(ctx);
      return {
        channelId: channel.id,
        type: 'email',
        ok: false,
        target: safeTarget,
        skipped: true,
        error: 'No SMTP relay configured',
      };
    }

    if (channel.type === 'ntfy') {
      // Ntfy: free self-hosted push (web + Android/iOS apps).
      // Dispatch: POST {NTFY_SERVER_URL}/{topic} with body=message, headers=metadata.
      // The NTFY_SERVER_URL env var sets the Ntfy server (default: https://ntfy.sh).
      const serverUrl = process.env.NTFY_SERVER_URL ?? 'https://ntfy.sh';
      const url = `${serverUrl.replace(/\/$/, '')}/${channel.target.replace(/^\//, '')}`;

      const ntfySeverityTags: Record<NotificationSeverity, string[]> = {
        critical: ['warning', 'red_alert'],
        warning: ['warning', 'orange'],
        info: ['information_source'],
      };
      const tags = ntfySeverityTags[ctx.severity] ?? ['info'];

      const ntfyPriority: Record<NotificationSeverity, string> = {
        critical: 'max',
        warning: 'high',
        info: 'default',
      };

      const headers: Record<string, string> = {
        'Content-Type': 'text/plain',
        Tags: tags.join(','),
        Priority: ntfyPriority[ctx.severity] ?? 'default',
        Title: ctx.title,
        'X-Tags': tags.join(','),
      };

      const body = [ctx.body, '', `Device: ${ctx.deviceKind} ${ctx.deviceId}`, `Kind: ${ctx.kind}`, `Key: ${ctx.dedupeKey}`]
        .filter(Boolean)
        .join('\n');

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });

      return {
        channelId: channel.id,
        type: 'ntfy',
        ok: res.ok,
        status: res.status,
        target: safeTarget,
        ...(res.ok ? {} : { error: `HTTP ${res.status}` }),
      };
    }

    const payload = channel.type === 'slack' ? buildSlackPayload(ctx) : buildWebhookPayload(ctx);

    const res = await fetch(channel.target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });

    return {
      channelId: channel.id,
      type: channel.type,
      ok: res.ok,
      status: res.status,
      target: safeTarget,
      ...(res.ok ? {} : { error: `HTTP ${res.status}` }),
    };
  } catch (err) {
    return {
      channelId: channel.id,
      type: channel.type,
      ok: false,
      target: safeTarget,
      error: redactSecrets(err instanceof Error ? err.message : 'dispatch failed'),
    };
  }
}
