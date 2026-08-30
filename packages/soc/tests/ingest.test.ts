import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  createEvent: vi.fn(),
}));

vi.mock('@ftth-copilot/db', () => ({
  prisma: { deviceEvent: { create: mocks.createEvent } },
}));

import { ingestEvent } from '../src/ingest';

beforeEach(() => {
  mocks.createEvent.mockReset();
  mocks.createEvent.mockResolvedValue({});
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
