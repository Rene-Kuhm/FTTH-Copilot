import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  findManySamples: vi.fn(),
  findManyAlerts: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock('@ftth-copilot/db', () => ({
  prisma: {
    metricSample: { findMany: mocks.findManySamples },
    detectedAlert: { findMany: mocks.findManyAlerts, upsert: mocks.upsert },
  },
}));

import { runDetection } from '../src/manager';

const NOW = new Date('2026-08-21T00:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

function rxSamples() {
  return [-22, -23, -24, -25, -26].map((v, i) => ({
    deviceKind: 'ONU',
    deviceId: 'onu-1',
    kind: 'RX_POWER_DBM',
    value: v,
    valueText: null,
    sampledAt: new Date(NOW.getTime() - (4 - i) * DAY),
  }));
}

function existingAlert(overrides: Record<string, unknown> = {}) {
  return {
    id: 'a1',
    tenantId: 't1',
    connectionId: 'c1',
    kind: 'predicted_low_signal',
    severity: 'warning',
    deviceKind: 'ONU',
    deviceId: 'onu-1',
    title: 'Señal en caída: onu-1',
    description: 'desc',
    etaMs: DAY,
    confidence: 1,
    status: 'open',
    firstSeenAt: new Date(NOW.getTime() - 1000),
    lastSeenAt: new Date(NOW.getTime() - 1000),
    lastNotifiedAt: new Date(NOW.getTime() - 1000),
    ...overrides,
  };
}

function okFetch() {
  return vi.fn(async () => new Response('{}', { status: 200 }));
}

beforeEach(() => {
  mocks.findManySamples.mockReset();
  mocks.findManyAlerts.mockReset();
  mocks.upsert.mockReset();
});

describe('runDetection', () => {
  it('detects, persists and notifies a new alert', async () => {
    mocks.findManySamples.mockResolvedValue(rxSamples());
    mocks.findManyAlerts.mockResolvedValue([]);
    mocks.upsert.mockResolvedValue({});
    const fetchImpl = okFetch();

    const result = await runDetection({
      tenantId: 't1',
      connectionId: 'c1',
      now: NOW,
      webhookUrl: 'https://example.com/hook',
      fetchImpl,
    });

    expect(result.detected).toBe(1);
    expect(result.upserted).toBe(1);
    expect(result.notified).toBe(1);
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('defaults now, lookback and cooldown when not provided', async () => {
    mocks.findManySamples.mockResolvedValue(rxSamples());
    mocks.findManyAlerts.mockResolvedValue([]);
    mocks.upsert.mockResolvedValue({});

    const result = await runDetection({ tenantId: 't1', connectionId: 'c1' });

    expect(result.detected).toBe(1);
    expect(result.upserted).toBe(1);
    expect(result.notified).toBe(0);
  });

  it('returns zeroes when there are no samples', async () => {
    mocks.findManySamples.mockResolvedValue([]);
    mocks.findManyAlerts.mockResolvedValue([]);

    const result = await runDetection({ tenantId: 't1', connectionId: 'c1', now: NOW });

    expect(result.detected).toBe(0);
    expect(result.upserted).toBe(0);
    expect(result.notified).toBe(0);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('skips notification when no webhook URL is provided', async () => {
    mocks.findManySamples.mockResolvedValue(rxSamples());
    mocks.findManyAlerts.mockResolvedValue([]);
    mocks.upsert.mockResolvedValue({});
    const fetchImpl = okFetch();

    const result = await runDetection({ tenantId: 't1', connectionId: 'c1', now: NOW, fetchImpl });

    expect(result.upserted).toBe(1);
    expect(result.notified).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('records a notification error when the webhook fails', async () => {
    mocks.findManySamples.mockResolvedValue(rxSamples());
    mocks.findManyAlerts.mockResolvedValue([]);
    mocks.upsert.mockResolvedValue({});
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 500, statusText: 'boom' }));

    const result = await runDetection({
      tenantId: 't1',
      connectionId: 'c1',
      now: NOW,
      webhookUrl: 'https://example.com/hook',
      fetchImpl,
    });

    expect(result.notified).toBe(0);
    expect(result.notificationError).toBe('boom');
  });

  it('does not re-notify an existing alert within the cooldown', async () => {
    mocks.findManySamples.mockResolvedValue(rxSamples());
    mocks.findManyAlerts.mockResolvedValue([existingAlert()]);
    mocks.upsert.mockResolvedValue({});
    const fetchImpl = okFetch();

    const result = await runDetection({
      tenantId: 't1',
      connectionId: 'c1',
      now: NOW,
      webhookUrl: 'https://example.com/hook',
      fetchImpl,
    });

    expect(result.detected).toBe(1);
    expect(result.upserted).toBe(1);
    expect(result.notified).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('auto-resolves a stale open alert when its finding stops appearing', async () => {
    mocks.findManySamples.mockResolvedValue([]);
    mocks.findManyAlerts.mockResolvedValue([
      existingAlert({ lastSeenAt: new Date(NOW.getTime() - 25 * 60 * 60 * 1000) }),
    ]);
    mocks.upsert.mockResolvedValue({});

    const result = await runDetection({
      tenantId: 't1',
      connectionId: 'c1',
      now: NOW,
      resolveAfterMs: 24 * 60 * 60 * 1000,
    });

    expect(result.detected).toBe(0);
    expect(result.upserted).toBe(1);
    expect(result.notified).toBe(0);

    const update = mocks.upsert.mock.calls[0][0].update;
    expect(update.status).toBe('resolved');
    expect(update.resolvedAt).toEqual(NOW);
  });
});
