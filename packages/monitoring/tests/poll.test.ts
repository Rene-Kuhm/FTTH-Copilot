import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { INmsConnector } from '@ftth-copilot/connectors-core';

const mocks = vi.hoisted(() => ({
  collectSamples: vi.fn(),
  persistSamples: vi.fn(),
  runRetention: vi.fn(),
  runDetection: vi.fn(),
}));

vi.mock('@ftth-copilot/analytics', () => ({
  collectSamples: mocks.collectSamples,
  persistSamples: mocks.persistSamples,
  runRetention: mocks.runRetention,
}));

vi.mock('@ftth-copilot/alerts', () => ({
  runDetection: mocks.runDetection,
}));

import { runPollCycle, pollConnections } from '../src/poll';

const connector = {} as INmsConnector;
const meta = { tenantId: 't1', connectionId: 'c1' };
const NOW = new Date('2026-08-21T00:00:00.000Z');

beforeEach(() => {
  mocks.collectSamples.mockReset();
  mocks.persistSamples.mockReset();
  mocks.runRetention.mockReset();
  mocks.runDetection.mockReset();
});

describe('runPollCycle', () => {
  it('samples, persists and detects in order', async () => {
    mocks.collectSamples.mockResolvedValue([{ deviceId: 'onu-1' }]);
    mocks.persistSamples.mockResolvedValue({ inserted: 3 });
    mocks.runDetection.mockResolvedValue({ detected: 1, upserted: 1, notified: 1 });

    const result = await runPollCycle(connector, meta, { now: NOW });

    expect(mocks.collectSamples).toHaveBeenCalledWith(connector, meta, expect.objectContaining({ now: NOW }));
    expect(mocks.persistSamples).toHaveBeenCalledWith([{ deviceId: 'onu-1' }]);
    expect(mocks.runDetection).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 't1', connectionId: 'c1', now: NOW }),
    );
    expect(result).toEqual({
      tenantId: 't1',
      connectionId: 'c1',
      samples: 3,
      detected: 1,
      upserted: 1,
      notified: 1,
    });
  });

  it('propagates includeOltDetail and webhook options', async () => {
    mocks.collectSamples.mockResolvedValue([]);
    mocks.persistSamples.mockResolvedValue({ inserted: 0 });
    mocks.runDetection.mockResolvedValue({ detected: 0, upserted: 0, notified: 0 });

    await runPollCycle(connector, meta, {
      now: NOW,
      includeOltDetail: true,
      webhookUrl: 'https://hook',
      cooldownMs: 1000,
      lookbackMs: 2000,
    });

    expect(mocks.collectSamples).toHaveBeenCalledWith(connector, meta, expect.objectContaining({ includeOltDetail: true }));
    expect(mocks.runDetection).toHaveBeenCalledWith(
      expect.objectContaining({ webhookUrl: 'https://hook', cooldownMs: 1000, lookbackMs: 2000 }),
    );
  });
});

describe('pollConnections', () => {
  it('polls every connection and isolates failures', async () => {
    mocks.collectSamples.mockResolvedValue([]);
    mocks.persistSamples.mockResolvedValue({ inserted: 0 });
    mocks.runDetection
      .mockResolvedValueOnce({ detected: 1, upserted: 1, notified: 1 })
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ detected: 0, upserted: 0, notified: 0 });

    const result = await pollConnections(
      [
        { connector, meta: { tenantId: 't1', connectionId: 'c1' } },
        { connector, meta: { tenantId: 't2', connectionId: 'c2' } },
        { connector, meta: { tenantId: 't3', connectionId: 'c3' } },
      ],
      { now: NOW },
    );

    expect(result.results).toHaveLength(2);
    expect(result.errors).toEqual([{ tenantId: 't2', connectionId: 'c2', error: 'boom' }]);
  });

  it('runs retention once when retentionDays is set', async () => {
    mocks.collectSamples.mockResolvedValue([]);
    mocks.persistSamples.mockResolvedValue({ inserted: 0 });
    mocks.runDetection.mockResolvedValue({ detected: 0, upserted: 0, notified: 0 });
    mocks.runRetention.mockResolvedValue({ deleted: 7 });

    const result = await pollConnections([{ connector, meta }], { now: NOW, retentionDays: 30 });

    expect(mocks.runRetention).toHaveBeenCalledTimes(1);
    expect(mocks.runRetention).toHaveBeenCalledWith({ retentionDays: 30, now: NOW });
    expect(result.deleted).toBe(7);
  });

  it('skips retention when retentionDays is undefined', async () => {
    mocks.collectSamples.mockResolvedValue([]);
    mocks.persistSamples.mockResolvedValue({ inserted: 0 });
    mocks.runDetection.mockResolvedValue({ detected: 0, upserted: 0, notified: 0 });

    const result = await pollConnections([{ connector, meta }], { now: NOW });

    expect(mocks.runRetention).not.toHaveBeenCalled();
    expect(result.deleted).toBe(0);
  });

  it('returns empty results for no entries', async () => {
    const result = await pollConnections([], { now: NOW });
    expect(result.results).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.deleted).toBe(0);
  });
});
