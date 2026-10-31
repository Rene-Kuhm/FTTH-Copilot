import { describe, expect, it, vi, beforeEach } from 'vitest';
import { JOB_NAMES } from '@ftth-copilot/jobs';

/**
 * The drain job handler of the worker.
 *
 * The handler is the only place where a queued job turns into work: it calls
 * the drainer of `@ftth-copilot/ingest`, which owns the durable spool and
 * the write into Postgres. The worker adds no domain logic of its own.
 */
const mocks = vi.hoisted(() => ({
  drainSpool: vi.fn(),
}));

vi.mock('@ftth-copilot/ingest', () => ({
  drainSpool: mocks.drainSpool,
}));

vi.mock('@ftth-copilot/scheduler', () => ({
  runScheduledPoll: vi.fn(),
  runScheduledFirmwareAudit: vi.fn(),
  runScheduledFecCollection: vi.fn(),
  tryStart: vi.fn(),
}));

import { JOB_HANDLERS, registeredJobNames } from '../src/registry';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.drainSpool.mockResolvedValue({
    drained: 2,
    failed: 0,
    quarantined: 0,
    batches: 1,
    backlogRemains: false,
  });
});

describe('the ingest drain handler', () => {
  it('is registered for the ingest drain job', () => {
    expect(registeredJobNames()).toContain(JOB_NAMES.ingestDrain);
  });

  it('drains the durable spool through the package', async () => {
    await JOB_HANDLERS[JOB_NAMES.ingestDrain]?.(
      { source: 'syslog', tenantId: 'tenant-worker', ingestId: 'ing-1' },
      {} as never,
    );

    expect(mocks.drainSpool).toHaveBeenCalledTimes(1);
  });

  it('drains the whole spool, not only the event of the payload', async () => {
    await JOB_HANDLERS[JOB_NAMES.ingestDrain]?.(
      { source: 'syslog', tenantId: 'tenant-worker', ingestId: 'ing-1' },
      {} as never,
    );

    // The handler takes no argument: a missed enqueue (a queue outage) must
    // not leave the events on disk forever.
    expect(mocks.drainSpool.mock.calls[0]).toHaveLength(0);
  });

  it('fails the job when the events could not be stored', async () => {
    mocks.drainSpool.mockResolvedValue({
      drained: 0,
      failed: 3,
      quarantined: 0,
      batches: 1,
      backlogRemains: true,
    });

    await expect(
      JOB_HANDLERS[JOB_NAMES.ingestDrain]?.({ source: 'syslog' }, {} as never),
    ).rejects.toThrow(/drain/i);
  });

  it('succeeds when the spool was already empty', async () => {
    mocks.drainSpool.mockResolvedValue({
      drained: 0,
      failed: 0,
      quarantined: 0,
      batches: 0,
      backlogRemains: false,
    });

    await expect(
      JOB_HANDLERS[JOB_NAMES.ingestDrain]?.({ source: 'syslog' }, {} as never),
    ).resolves.toBeDefined();
  });
});
