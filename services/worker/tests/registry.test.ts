import { describe, expect, it, vi, beforeEach } from 'vitest';
import { JOB_NAMES } from '@ftth-copilot/jobs';
import { __setLogSinkForTests } from '@ftth-copilot/shared';

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
  executeInvestigationAttempt: vi.fn(),
  expireStaleRuns: vi.fn(),
  runLearningSnapshot: vi.fn(),
}));

vi.mock('@ftth-copilot/investigations', () => ({
  executeInvestigationAttempt: mocks.executeInvestigationAttempt,
  expireStaleRuns: mocks.expireStaleRuns,
}));

vi.mock('@ftth-copilot/scheduler', () => ({
  runScheduledPoll: mocks.runScheduledPoll,
  runScheduledFirmwareAudit: mocks.runScheduledFirmwareAudit,
  runScheduledFecCollection: mocks.runScheduledFecCollection,
  tryStart: mocks.tryStart,
}));

vi.mock('../src/learning-snapshot', () => ({
  runLearningSnapshot: mocks.runLearningSnapshot,
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
  mocks.runLearningSnapshot.mockResolvedValue([]);
});

describe('job handler registry', () => {
  it('registers the recurring loops, the ingest drain and the investigation jobs', () => {
    expect(registeredJobNames().sort()).toEqual(
      [
        JOB_NAMES.fecCollection,
        JOB_NAMES.firmwareAudit,
        JOB_NAMES.ingestDrain,
        JOB_NAMES.pollConnections,
        JOB_NAMES.investigationRun,
        JOB_NAMES.investigationSweep,
        JOB_NAMES.learningSnapshot,
      ].sort(),
    );
  });

  it('has a handler for every job it owns and only for known job names', () => {
    const known = new Set<string>(Object.values(JOB_NAMES));

    for (const name of registeredJobNames()) {
      expect(known.has(name)).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(JOB_HANDLERS, name)).toBe(true);
    }
  });

  it('has a handler for the ingest job: the syslog receiver spools and the job drains', () => {
    expect(
      Object.prototype.hasOwnProperty.call(JOB_HANDLERS, JOB_NAMES.ingestDrain),
    ).toBe(true);
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

describe('investigation jobs', () => {
  const payload = {
    tenantId: 't1',
    incidentId: 'inc-1',
    runId: 'r_1',
    versionId: 'v_1',
    userId: 'u1',
    startedAtMs: 0,
  };
  const job = (attemptsMade: number) =>
    ({ attemptsMade, opts: { attempts: 3 } }) as unknown as Parameters<
      NonNullable<typeof JOB_HANDLERS['investigation-run']>
    >[1];
  const runHandler = JOB_HANDLERS['investigation-run']!;

  it('hands the retry context of the queue to the attempt', async () => {
    mocks.executeInvestigationAttempt.mockResolvedValue({ status: 'skipped', reason: 'x' });

    await runHandler(payload, job(1));

    expect(mocks.executeInvestigationAttempt).toHaveBeenCalledWith(payload, {
      attemptsMade: 1,
      maxAttempts: 3,
    });
  });

  it('throws only on a retry outcome, so BullMQ retries with its backoff', async () => {
    mocks.executeInvestigationAttempt.mockResolvedValue({
      status: 'retry',
      error: new Error('connection refused'),
    });

    await expect(runHandler(payload, job(0))).rejects.toThrow('connection refused');
  });

  it('does not throw on a failed attempt: the run is already failed', async () => {
    mocks.executeInvestigationAttempt.mockResolvedValue({ status: 'failed', reason: 'bad data' });
    const lines: string[] = [];
    __setLogSinkForTests((line) => lines.push(line));
    try {
      await expect(runHandler(payload, job(2))).resolves.toEqual({ status: 'failed', reason: 'bad data' });
      expect(JSON.parse(lines[0]!)).toMatchObject({ level: 'warn', name: 'worker-registry', tenantId: payload.tenantId, runId: payload.runId });
    } finally {
      __setLogSinkForTests(null);
    }
  });

  it('sweeps with the TTL of the environment', async () => {
    mocks.expireStaleRuns.mockResolvedValue(0);
    const previous = process.env['INVESTIGATION_PENDING_TTL_MS'];
    process.env['INVESTIGATION_PENDING_TTL_MS'] = '120000';
    try {
      await JOB_HANDLERS['investigation-sweep']!({}, job(0) as never);
    } finally {
      if (previous === undefined) delete process.env['INVESTIGATION_PENDING_TTL_MS'];
      else process.env['INVESTIGATION_PENDING_TTL_MS'] = previous;
    }

    expect(mocks.expireStaleRuns).toHaveBeenCalledWith({ ttlMs: 120000 });
  });
});

describe('the learning snapshot job', () => {
  it('freezes the dataset through the shell of persistence', async () => {
    mocks.runLearningSnapshot.mockResolvedValue([
      {
        tenantId: 't1',
        snapshotHash: 's_0123456789abcdef',
        created: true,
        counts: { events: 2, labelled: 1 },
      },
    ]);

    await JOB_HANDLERS[JOB_NAMES.learningSnapshot]?.(
      { tenantId: 't1', windowDays: 14 },
      {} as never,
    );

    expect(mocks.runLearningSnapshot).toHaveBeenCalledTimes(1);
    expect(mocks.runLearningSnapshot).toHaveBeenCalledWith({
      tenantId: 't1',
      windowDays: 14,
    });
  });

  it('freezes every tenant when the payload does not narrow it', async () => {
    await JOB_HANDLERS[JOB_NAMES.learningSnapshot]?.({}, {} as never);

    expect(mocks.runLearningSnapshot).toHaveBeenCalledWith({
      tenantId: undefined,
      windowDays: undefined,
    });
  });
});
