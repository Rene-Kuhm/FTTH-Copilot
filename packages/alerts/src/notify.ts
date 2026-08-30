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
