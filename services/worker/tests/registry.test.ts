import { describe, expect, it, vi, beforeEach } from 'vitest';
import { JOB_NAMES } from '@ftth-copilot/jobs';

/**
 * Job handler registry of the worker.
 *
 * The worker is an *execution host*: it does not own domain logic, it
 * translates a queued job into a call to a package function
 * (`@ftth-copilot/scheduler`). That translation is the only thing this
 * registry holds.
 *
 * A job name with no handler is a wiring bug, not a transient failure:
 * `defineWorker` throws so BullMQ retries the job and finally dead-letters it,
 * instead of silently dropping the work.
 */

const mocks = vi.hoisted(() => ({
  runScheduledPoll: vi.fn(),
  runScheduledFirmwareAudit: vi.fn(),
  runScheduledFecCollection: vi.fn(),
  tryStart: vi.fn(),
}));

vi.mock('@ftth-copilot/scheduler', () => ({
  runScheduledPoll: mocks.runScheduledPoll,
  runScheduledFirmwareAudit: mocks.runScheduledFirmwareAudit,
  runScheduledFecCollection: mocks.runScheduledFecCollection,
  tryStart: mocks.tryStart,
}));

import { JOB_HANDLERS, registeredJobNames } from '../src/registry';

beforeEach(() => {
  vi.clearAllMocks();
  // The real `tryStart` is the single-flight guard of the loop; the mock
  // keeps that shape (it runs the tick it is given) without touching
  // Postgres.
  mocks.tryStart.mockImplementation(async (_name: string, run: () => Promise<unknown>) => {
    await run();
  });
});

describe('job handler registry', () => {
  it('registers the three recurring loops', () => {
    expect(registeredJobNames().sort()).toEqual(
      [JOB_NAMES.fecCollection, JOB_NAMES.firmwareAudit, JOB_NAMES.pollConnections].sort(),
    );
  });

  it('has a handler for every job it owns and only for known job names', () => {
    const known = new Set<string>(Object.values(JOB_NAMES));

    for (const name of registeredJobNames()) {
      expect(known.has(name)).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(JOB_HANDLERS, name)).toBe(true);
    }
  });

  it('has no handler for the ingest job (it arrives with the syslog/SNMP move)', () => {
    expect(
      Object.prototype.hasOwnProperty.call(JOB_HANDLERS, JOB_NAMES.ingestDrain),
    ).toBe(false);
  });
});

describe('job handlers', () => {
  it('poll-connections runs the scheduled poll', async () => {
    await JOB_HANDLERS[JOB_NAMES.pollConnections]?.({}, {} as never);

    expect(mocks.runScheduledPoll).toHaveBeenCalledTimes(1);
    expect(mocks.runScheduledFirmwareAudit).not.toHaveBeenCalled();
    expect(mocks.runScheduledFecCollection).not.toHaveBeenCalled();
  });

  it('firmware-audit runs the scheduled firmware audit', async () => {
    await JOB_HANDLERS[JOB_NAMES.firmwareAudit]?.({}, {} as never);

    expect(mocks.runScheduledFirmwareAudit).toHaveBeenCalledTimes(1);
    expect(mocks.runScheduledPoll).not.toHaveBeenCalled();
    expect(mocks.runScheduledFecCollection).not.toHaveBeenCalled();
  });

  it('fec-collection runs the scheduled FEC collection', async () => {
    await JOB_HANDLERS[JOB_NAMES.fecCollection]?.({}, {} as never);

    expect(mocks.runScheduledFecCollection).toHaveBeenCalledTimes(1);
    expect(mocks.runScheduledPoll).not.toHaveBeenCalled();
    expect(mocks.runScheduledFirmwareAudit).not.toHaveBeenCalled();
  });

  it('runs every tick through the single-flight guard of the scheduler', async () => {
    await JOB_HANDLERS[JOB_NAMES.pollConnections]?.({}, {} as never);

    expect(mocks.tryStart).toHaveBeenCalledTimes(1);
    expect(mocks.tryStart.mock.calls[0]?.[0]).toBe('polling');
  });
});
