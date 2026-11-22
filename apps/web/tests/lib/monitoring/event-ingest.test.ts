import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  eventIngestStats: vi.fn(),
}));

vi.mock('@ftth-copilot/ingest', () => ({
  eventIngestStats: mocks.eventIngestStats,
}));

import * as eventIngest from '@/lib/monitoring/event-ingest';

describe('event-ingest monitoring re-export', () => {
  it('delegates eventIngestStats to @ftth-copilot/ingest', () => {
    const sample = {
      spooled: 10,
      drained: 8,
      dropped: 1,
      deadLettered: 0,
      pending: 1,
    };
    mocks.eventIngestStats.mockReturnValue(sample);

    expect(eventIngest.eventIngestStats).toBe(mocks.eventIngestStats);
    expect(eventIngest.eventIngestStats()).toEqual(sample);
    expect(mocks.eventIngestStats).toHaveBeenCalledTimes(1);
  });
});
