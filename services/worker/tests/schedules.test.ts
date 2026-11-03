import { describe, expect, it, vi, beforeEach } from 'vitest';
import { JOB_NAMES, recurringSchedulerId } from '@ftth-copilot/jobs';
import { __resetSchedulerHealth, snapshotHealth } from '@ftth-copilot/scheduler';

/**
 * The registration of the recurring schedules.
 *
 * The queue is mocked, so this spec pins the *contract* of the registration:
 * which queue every loop lands on, which job name it carries, the stable
 * scheduler id and the period. The idempotency of the upsert (one schedule
 * per scheduler id, however many times the registration runs) is proven
 * against a real Redis in `schedules.integration.test.ts`.
 */
const mocks = vi.hoisted(() => ({
  createJobQueue: vi.fn(),
  scheduleRecurring: vi.fn(),
  nextSchedulerRun: vi.fn(),
  enqueueJob: vi.fn(),
  closeQueue: vi.fn(),
  onQueue: vi.fn(),
}));

vi.mock('@ftth-copilot/jobs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ftth-copilot/jobs')>();
  return {
    ...actual,
    createJobQueue: mocks.createJobQueue,
    scheduleRecurring: mocks.scheduleRecurring,
    nextSchedulerRun: mocks.nextSchedulerRun,
    enqueueJob: mocks.enqueueJob,
  };
});

import { INGEST_DRAIN_LOOP, LEARNING_SNAPSHOT_LOOP, registerRecurringSchedules } from '../src/schedules';
import { WARMUP_MS } from '../src/warmup';

/** The registration of one loop, as it reached the queue. */
interface RegisteredSchedule {
  schedulerId: string;
  everyMs: number;
  name: string;
  data: unknown;
}

function schedules(): RegisteredSchedule[] {
  return mocks.scheduleRecurring.mock.calls.map((call) => {
    const [, schedule] = call as [unknown, RegisteredSchedule];
    return schedule;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // El registro de salud vive en la memoria del proceso: sin limpiarlo, el
  // estado de un test se leeria en el siguiente.
  __resetSchedulerHealth();
  mocks.createJobQueue.mockReturnValue({ close: mocks.closeQueue, on: mocks.onQueue });
  mocks.scheduleRecurring.mockResolvedValue(undefined);
  // Por defecto ningún schedule tiene un tick conocido; cada test dice lo
  // que le conviene con `nextRuns`.
  mocks.nextSchedulerRun.mockResolvedValue(null);
  mocks.enqueueJob.mockResolvedValue(undefined);
});

/**
 * El tick de calentamiento.
 *
 * El schedule de un loop no se reprograma: después de un reinicio, el
 * próximo tick es el que la rejilla tenía previsto, y para el firmware
 * ese tick está a 24 h. El tick de calentamiento es el que hace que el
 * loop pruebe que funciona enseguida, y su id sale de la ranura del
 * schedule para que dos workers que arrancan a la vez no lo hagan dos
 * veces.
 */
describe('el tick de calentamiento', () => {
  const FAR = Date.now() + 6 * 60 * 60 * 1000;
  const NEAR = Date.now() + 5_000;

  /**
   * Cada schedule tiene su propio reloj: el poll puede tener su tick a 24 h
   * y el drenaje —que corre cada 30 s— el suyo a la vista.
   */
  function nextRuns(far: string[]): void {
    mocks.nextSchedulerRun.mockImplementation(
      async (_queue: unknown, schedulerId: string) =>
        far.some((scope) => schedulerId.includes(scope)) ? FAR : NEAR,
    );
  }

  it('no se encola cuando el schedule ya tiene un tick a la vista', async () => {
    nextRuns([]);

    await registerRecurringSchedules({ env: { METRICS_POLLER_ENABLED: 'true' } });

    expect(mocks.enqueueJob).not.toHaveBeenCalled();
  });

  it('se encola cuando el próximo tick del schedule está lejos', async () => {
    nextRuns(['poll-connections']);

    await registerRecurringSchedules({ env: { METRICS_POLLER_ENABLED: 'true' } });

    expect(mocks.enqueueJob).toHaveBeenCalledTimes(1);
  });

  it('lleva el id determinista de la ranura del schedule y el retraso del calentamiento', async () => {
    nextRuns(['poll-connections']);

    await registerRecurringSchedules({ env: { METRICS_POLLER_ENABLED: 'true' } });

    const [, name, data, options] = mocks.enqueueJob.mock.calls[0] as [
      unknown,
      string,
      unknown,
      { jobId: string; delayMs: number },
    ];
    expect(name).toBe(JOB_NAMES.pollConnections);
    expect(data).toEqual({});
    expect(options.jobId).toBe(`warmup-poll-connections-${FAR}`);
    expect(options.delayMs).toBe(WARMUP_MS);
  });

  it('cada loop tiene su propio job de calentamiento', async () => {
    nextRuns(['poll-connections', 'firmware-audit']);

    await registerRecurringSchedules({
      env: { METRICS_POLLER_ENABLED: 'true', FIRMWARE_AUDIT_ENABLED: 'true' },
    });

    const ids = mocks.enqueueJob.mock.calls.map(
      (call) => (call as [unknown, unknown, unknown, { jobId: string }])[3].jobId,
    );
    expect(ids).toEqual([`warmup-poll-connections-${FAR}`, `warmup-firmware-audit-${FAR}`]);
  });
});

/**
 * El plazo del próximo tick.
 *
 * Es lo que dice que un loop que todavía no tickeó está calentando y no
 * colgado: el registro de salud se vacía en cada arranque, y sin el plazo
 * el health del sistema queda degradado hasta el primer tick.
 */
describe('el plazo del próximo tick en el registro de salud', () => {
  it('publica cuándo espera el próximo tick de cada loop y con qué cadencia', async () => {
    const FAR = Date.now() + 6 * 60 * 60 * 1000;
    mocks.nextSchedulerRun.mockResolvedValue(FAR);

    await registerRecurringSchedules({ env: { METRICS_POLLER_ENABLED: 'true' } });

    const snap = snapshotHealth();
    expect(snap['polling']?.nextRunAt).toBe(FAR);
    expect(snap['polling']?.intervalMs).toBe(900_000);
  });

  it('no publica un plazo para un loop que no está habilitado', async () => {
    await registerRecurringSchedules({ env: {} });

    expect(snapshotHealth()['polling']).toBeUndefined();
  });
});

describe('the periodic drain of the durable spool', () => {
  it('is registered even when no receiver is enabled: it is the safety net', async () => {
    const result = await registerRecurringSchedules({ env: {} });

    // The investigation sweep has no flag either: both are safety nets.
    expect(result.registered.map((loop) => loop.scope)).toEqual([
      'ingest-drain',
      'investigation-sweep',
    ]);
  });

  it('lands on the ingest queue with the drain job', async () => {
    await registerRecurringSchedules({ env: {} });

    expect(mocks.createJobQueue.mock.calls[0]?.[0]).toBe('ingest');
    const [schedule] = schedules();
    expect(schedule?.name).toBe(JOB_NAMES.ingestDrain);
  });

  it('uses a stable scheduler id, so registering twice leaves one schedule', async () => {
    await registerRecurringSchedules({ env: {} });
    await registerRecurringSchedules({ env: {} });

    const ids = schedules().map((schedule) => schedule.schedulerId);
    // Two loops without a flag, each registered twice: still one id per loop.
    expect(new Set(ids)).toEqual(
      new Set([recurringSchedulerId('ingest-drain'), recurringSchedulerId('investigation-sweep')]),
    );
  });

  it('carries the payload the drain handler understands', async () => {
    await registerRecurringSchedules({ env: {} });

    // The handler drains the whole spool whatever the source says, so one
    // schedule covers both receivers.
    const [schedule] = schedules();
    expect(schedule?.data).toEqual({ source: 'syslog' });
  });

  it('drains every 30 seconds by default', async () => {
    await registerRecurringSchedules({ env: {} });

    const [schedule] = schedules();
    expect(schedule?.everyMs).toBe(30_000);
  });

  it('reads the period from the environment', async () => {
    await registerRecurringSchedules({ env: { INGEST_DRAIN_INTERVAL_MS: '5000' } });

    const [schedule] = schedules();
    expect(schedule?.everyMs).toBe(5_000);
  });

  it('falls back to the default when the period is invalid', async () => {
    await registerRecurringSchedules({ env: { INGEST_DRAIN_INTERVAL_MS: 'nonsense' } });

    const [schedule] = schedules();
    expect(schedule?.everyMs).toBe(30_000);
  });

  it('is the drain loop of the ingest queue', () => {
    expect(INGEST_DRAIN_LOOP.queue).toBe('ingest');
    expect(INGEST_DRAIN_LOOP.jobName).toBe(JOB_NAMES.ingestDrain);
    expect(INGEST_DRAIN_LOOP.scope).toBe('ingest-drain');
  });
});

describe('the learning snapshot loop', () => {
  it('is not registered unless it is enabled: it writes rows and nobody consumes them yet', async () => {
    const result = await registerRecurringSchedules({ env: {} });

    expect(result.registered.map((loop) => loop.scope)).not.toContain('learning-snapshot');
    expect(result.skipped.map((loop) => loop.scope)).toContain('learning-snapshot');
  });

  it('lands on the learning queue with the snapshot job when it is enabled', async () => {
    await registerRecurringSchedules({ env: { LEARNING_SNAPSHOT_ENABLED: 'true' } });

    const schedule = schedules().find((s) => s.name === JOB_NAMES.learningSnapshot);
    expect(schedule).toBeDefined();
    expect(schedule?.everyMs).toBe(86_400_000);
  });

  it('reads the period from the environment', async () => {
    await registerRecurringSchedules({
      env: { LEARNING_SNAPSHOT_ENABLED: 'true', LEARNING_SNAPSHOT_INTERVAL_MS: '3600000' },
    });

    const schedule = schedules().find((s) => s.name === JOB_NAMES.learningSnapshot);
    expect(schedule?.everyMs).toBe(3_600_000);
  });

  it('is the snapshot loop of the learning queue', () => {
    expect(LEARNING_SNAPSHOT_LOOP.queue).toBe('learning');
    expect(LEARNING_SNAPSHOT_LOOP.jobName).toBe(JOB_NAMES.learningSnapshot);
    expect(LEARNING_SNAPSHOT_LOOP.scope).toBe('learning-snapshot');
  });
});

describe('the health registry of the scheduled loops', () => {
  beforeEach(async () => {
    const { __resetSchedulerHealth } = await import('@ftth-copilot/scheduler');
    __resetSchedulerHealth();
  });

  it('marks the loops it schedules as expected', async () => {
    const { snapshotHealth } = await import('@ftth-copilot/scheduler');

    await registerRecurringSchedules({
      env: {
        METRICS_POLLER_ENABLED: 'true',
        FIRMWARE_AUDIT_ENABLED: 'true',
        FEC_COLLECTION_ENABLED: 'true',
      },
    });

    // A loop that is not expected is not watched: the health would not
    // report it as hung, and a poll that stops ticking would go unnoticed.
    expect(snapshotHealth()['polling']?.expected).toBe(true);
    expect(snapshotHealth()['firmware']?.expected).toBe(true);
    expect(snapshotHealth()['fec']?.expected).toBe(true);
  });

  it('does not mark a loop it did not schedule', async () => {
    const { snapshotHealth } = await import('@ftth-copilot/scheduler');

    await registerRecurringSchedules({ env: { METRICS_POLLER_ENABLED: 'true' } });

    expect(snapshotHealth()['polling']?.expected).toBe(true);
    expect(snapshotHealth()['firmware']).toBeUndefined();
    expect(snapshotHealth()['fec']).toBeUndefined();
  });
});
