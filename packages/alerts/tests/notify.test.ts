import { describe, it, expect, vi } from 'vitest';
import { sendWebhook, buildAlertPayload, sendTelegram, buildAlertText } from '../src/notify';
import type { AlertRecord } from '../src/types';

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

function makeFetch(status: number, statusText = ''): FetchLike {
  return vi.fn(async () => new Response('{}', { status, statusText })) as FetchLike;
}

describe('sendWebhook', () => {
  it('returns ok for a 2xx response', async () => {
    const res = await sendWebhook('https://example.com/hook', { a: 1 }, makeFetch(200));
    expect(res).toEqual({ ok: true, status: 200 });
  });

  it('returns not-ok for a non-2xx response', async () => {
    const res = await sendWebhook('https://example.com/hook', {}, makeFetch(500, 'boom'));
    expect(res.ok).toBe(false);
    expect(res.status).toBe(500);
    expect(res.error).toBe('boom');
  });

  it('catches fetch errors', async () => {
    const failing = vi.fn(async () => {
      throw new Error('net');
    }) as FetchLike;
    const res = await sendWebhook('https://example.com/hook', {}, failing);
    expect(res.ok).toBe(false);
    expect(res.error).toBe('net');
  });

  it('posts JSON with the correct method, headers and body', async () => {
    let captured: RequestInit | undefined;
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      captured = init;
      return new Response('{}', { status: 204 });
    }) as FetchLike;

    await sendWebhook('https://example.com/hook', { hello: 'world' }, fetchImpl);

    expect(captured!.method).toBe('POST');
    expect(captured!.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(captured!.body as string)).toEqual({ hello: 'world' });
  });
});

describe('buildAlertPayload', () => {
  it('shapes a batch of alerts for the webhook', () => {
    const record: AlertRecord = {
      id: 'a1',
      tenantId: 't1',
      connectionId: 'c1',
      kind: 'predicted_low_signal',
      severity: 'warning',
      deviceKind: 'ONU',
      deviceId: 'onu-1',
      title: 'T',
      description: 'D',
      etaMs: 1000,
      confidence: 0.9,
      status: 'open',
      firstSeenAt: new Date('2026-08-21T00:00:00.000Z'),
      lastSeenAt: new Date('2026-08-21T00:00:00.000Z'),
      lastNotifiedAt: null,
    };

    const payload = buildAlertPayload([record]) as {
      type: string;
      count: number;
      alerts: Array<Record<string, unknown>>;
    };

    expect(payload.type).toBe('ftth-copilot.alerts');
    expect(payload.count).toBe(1);
    expect(payload.alerts[0]!.deviceId).toBe('onu-1');
    expect(payload.alerts[0]!.kind).toBe('predicted_low_signal');
    expect(payload.alerts[0]!.etaMs).toBe(1000);
  });

  it('maps missing optional fields to null', () => {
    const record: AlertRecord = {
      tenantId: 't1',
      connectionId: null,
      kind: 'frequent_reboots',
      severity: 'critical',
      deviceKind: 'OLT',
      deviceId: 'olt-1',
      title: 'T',
      description: 'D',
      status: 'open',
      firstSeenAt: new Date('2026-08-21T00:00:00.000Z'),
      lastSeenAt: new Date('2026-08-21T00:00:00.000Z'),
      lastNotifiedAt: null,
    };

    const payload = buildAlertPayload([record]) as {
      alerts: Array<Record<string, unknown>>;
    };

    expect(payload.alerts[0]!.id).toBeNull();
    expect(payload.alerts[0]!.etaMs).toBeNull();
    expect(payload.alerts[0]!.confidence).toBeNull();
  });
});

describe('buildAlertText', () => {
  it('formats a digest with one line per alert', () => {
    const warning: AlertRecord = {
      tenantId: 't1',
      connectionId: 'c1',
      kind: 'predicted_low_signal',
      severity: 'warning',
      deviceKind: 'ONU',
      deviceId: 'onu-1',
      title: 'Señal en caída',
      description: 'd',
      status: 'open',
      firstSeenAt: new Date('2026-08-21T00:00:00.000Z'),
      lastSeenAt: new Date('2026-08-21T00:00:00.000Z'),
      lastNotifiedAt: null,
    };
    const critical: AlertRecord = {
      ...warning,
      kind: 'frequent_reboots',
      severity: 'critical',
      deviceKind: 'OLT',
      deviceId: 'olt-1',
      title: 'Reinicios repetidos',
    };

    const text = buildAlertText([warning, critical]);

    expect(text).toContain('FTTH-Copilot — 2 alertas');
    expect(text).toContain('🟡 [ONU onu-1] Señal en caída');
    expect(text).toContain('🔴 [OLT olt-1] Reinicios repetidos');
  });
});

describe('sendTelegram', () => {
  it('posts the message to the Telegram bot API', async () => {
    let capturedUrl = '';
    let capturedBody = '';
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedBody = init.body as string;
      return new Response('{}', { status: 200 });
    }) as FetchLike;

    const res = await sendTelegram('tok123', 'chat456', 'hola', fetchImpl);

    expect(res).toEqual({ ok: true, status: 200 });
    expect(capturedUrl).toBe('https://api.telegram.org/bottok123/sendMessage');
    expect(JSON.parse(capturedBody)).toEqual({ chat_id: 'chat456', text: 'hola' });
  });

  it('returns not-ok on a non-2xx response', async () => {
    const res = await sendTelegram('t', 'c', 'x', makeFetch(401, 'Unauthorized'));
    expect(res.ok).toBe(false);
    expect(res.status).toBe(401);
    expect(res.error).toBe('Unauthorized');
  });
});
