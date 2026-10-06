import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  createEvent: vi.fn(),
  createManyEvents: vi.fn(),
}));

vi.mock('@ftth-copilot/db', () => ({
  prisma: {
    deviceEvent: { create: mocks.createEvent, createMany: mocks.createManyEvents },
  },
}));

import { ingestEvent, ingestEvents } from '../src/ingest';

beforeEach(() => {
  mocks.createEvent.mockReset();
  mocks.createEvent.mockResolvedValue({});
  mocks.createManyEvents.mockReset();
  mocks.createManyEvents.mockResolvedValue({ count: 0 });
});

describe('ingestEvent', () => {
  it('persists a classified event', async () => {
    const at = new Date('2026-08-21T00:00:00.000Z');
    await ingestEvent({
      tenantId: 't1',
      category: 'auth_failure',
      sourceIp: '1.2.3.4',
      facility: 10,
      severity: 6,
      message: 'failed password',
      occurredAt: at,
    });

    expect(mocks.createEvent).toHaveBeenCalledWith({
      data: {
        tenantId: 't1',
        connectionId: null,
        sourceIp: '1.2.3.4',
        facility: 10,
        severity: 6,
        category: 'auth_failure',
        message: 'failed password',
        occurredAt: at,
        ingestId: null,
      },
    });
  });

  it('defaults optional fields', async () => {
    await ingestEvent({ tenantId: 't1', category: 'other', message: 'x' });
    const data = mocks.createEvent.mock.calls[0][0].data;
    expect(data.connectionId).toBeNull();
    expect(data.sourceIp).toBeNull();
    expect(data.facility).toBeNull();
    expect(data.severity).toBeNull();
    expect(data.occurredAt).toBeInstanceOf(Date);
  });
});

describe('ingestEvents', () => {
  const at = new Date('2026-08-21T00:00:00.000Z');

  it('persists a batch in a single call and skips duplicates', async () => {
    mocks.createManyEvents.mockResolvedValue({ count: 2 });

    const inserted = await ingestEvents([
      { tenantId: 't1', category: 'auth_failure', message: 'a', ingestId: 'i-1' },
      { tenantId: 't1', category: 'auth_failure', message: 'b', ingestId: 'i-2' },
    ]);

    expect(inserted).toBe(2);
    expect(mocks.createManyEvents).toHaveBeenCalledTimes(1);
    // Retry safety depends on this flag: a replayed batch must not duplicate.
    expect(mocks.createManyEvents.mock.calls[0][0].skipDuplicates).toBe(true);
    expect(mocks.createManyEvents.mock.calls[0][0].data).toHaveLength(2);
    expect(mocks.createManyEvents.mock.calls[0][0].data[0].ingestId).toBe('i-1');
  });

  it('does not call the database for an empty batch', async () => {
    expect(await ingestEvents([])).toBe(0);
    expect(mocks.createManyEvents).not.toHaveBeenCalled();
  });

  it('carries the ingest id through so a retry is deduplicable', async () => {
    await ingestEvents([
      { tenantId: 't1', category: 'other', message: 'x', ingestId: 'stable-id' },
    ]);

    const rows = mocks.createManyEvents.mock.calls[0][0].data;
    expect(rows[0].ingestId).toBe('stable-id');
    // No occurredAt supplied, so it must be stamped at insert time.
    expect(rows[0].occurredAt).toBeInstanceOf(Date);
  });

  it('propagates a database failure so the drainer can retry', async () => {
    mocks.createManyEvents.mockRejectedValue(new Error('connection refused'));

    await expect(
      ingestEvents([
        { tenantId: 't1', category: 'other', message: 'x', ingestId: 'i-9' },
      ]),
    ).rejects.toThrow('connection refused');
  });
});
