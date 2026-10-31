import { describe, expect, it, vi, beforeEach } from 'vitest';
import { JOB_NAMES, ingestDrainJobId } from '@ftth-copilot/jobs';
import { __resetSchedulerHealth, snapshotHealth } from '@ftth-copilot/scheduler';
import type { TelemetryEvent } from '@ftth-copilot/shared';

/**
 * The SNMP receiver of the worker.
 *
 * The worker binds the socket, spools every trap into the durable spool and
 * enqueues the job that drains the spool into Postgres. This spec pins the
 * wiring: the job name, the payload and the stable job id, plus what happens
 * when the queue is down.
 *
 * The queue and the receiver are mocked: the vocabulary of the queue (the job
 * name and the job id) is the real one, so the assertions are about the
 * contract and not about a mock.
 */
const mocks = vi.hoisted(() => ({
  createJobQueue: vi.fn(),
  enqueueJob: vi.fn(),
  startSnmpReceiver: vi.fn(),
  spoolSnmpTrap: vi.fn(),
  storeEvidence: vi.fn(),
  closeQueue: vi.fn(),
  onQueue: vi.fn(),
}));

vi.mock('@ftth-copilot/jobs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ftth-copilot/jobs')>();
  return {
    ...actual,
    createJobQueue: mocks.createJobQueue,
    enqueueJob: mocks.enqueueJob,
  };
});

vi.mock('@ftth-copilot/ingest', () => ({
  startSnmpReceiver: mocks.startSnmpReceiver,
  spoolSnmpTrap: mocks.spoolSnmpTrap,
  storeEvidence: mocks.storeEvidence,
}));

import { startWorkerSnmpReceiver } from '../src/snmp';

/** The options the worker handed to the receiver. */
function receiverOptions(): {
  startInProcessDrainer?: boolean;
  onEvent?: (event: TelemetryEvent) => void;
  onEvidence?: (evidence: unknown) => void;
} {
  const call = mocks.startSnmpReceiver.mock.calls[0];
  return (call?.[0] ?? {}) as {
    startInProcessDrainer?: boolean;
    onEvent?: (event: TelemetryEvent) => void;
    onEvidence?: (evidence: unknown) => void;
  };
}

/** A normalised trap, as the receiver hands it to the worker. */
function telemetryEvent(overrides: Partial<TelemetryEvent> = {}): TelemetryEvent {
  return {
    schema: 'ftth.telemetry.v1',
    tenantId: 'tenant-worker',
    deviceKind: 'OLT',
    deviceId: 'OLT-01',
    source: 'snmp-trap',
    ts: '2026-10-06T10:00:00.000Z',
    metrics: {},
    tags: {
      connectionId: 'conn-1',
      oltId: 'OLT-01',
      vendor: 'Huawei',
      trapCategory: 'link_down',
    },
    ...overrides,
  };
}

/** Lets the pending enqueue settle. */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

const ENV_ENABLED = {
  SNMP_RECEIVER_ENABLED: 'true',
  SNMP_TENANT_ID: 'tenant-worker',
};

beforeEach(() => {
  vi.clearAllMocks();
  // The health registry is process-wide: each test starts from a clean one.
  __resetSchedulerHealth();
  mocks.createJobQueue.mockReturnValue({ close: mocks.closeQueue, on: mocks.onQueue });
  mocks.enqueueJob.mockResolvedValue({ id: 'job-1' });
  mocks.startSnmpReceiver.mockReturnValue(() => {});
  mocks.spoolSnmpTrap.mockReturnValue('ing-1');
  mocks.storeEvidence.mockResolvedValue(undefined);
});

describe('the worker SNMP receiver', () => {
  it('starts the receiver of the package', () => {
    startWorkerSnmpReceiver({ env: ENV_ENABLED });

    expect(mocks.startSnmpReceiver).toHaveBeenCalledTimes(1);
  });

  it('does not start the in-process drainer: the worker drains through the queue', () => {
    startWorkerSnmpReceiver({ env: ENV_ENABLED });

    expect(receiverOptions().startInProcessDrainer).toBe(false);
  });

  it('spools every trap it receives before asking for a drain', () => {
    startWorkerSnmpReceiver({ env: ENV_ENABLED });

    receiverOptions().onEvent?.(telemetryEvent());

    expect(mocks.spoolSnmpTrap).toHaveBeenCalledTimes(1);
  });

  it('enqueues a drain job for every trap it receives', async () => {
    startWorkerSnmpReceiver({ env: ENV_ENABLED });

    receiverOptions().onEvent?.(telemetryEvent());
    await flush();

    expect(mocks.enqueueJob).toHaveBeenCalledTimes(1);
    const [queue, name, payload, options] = mocks.enqueueJob.mock.calls[0] as [
      unknown,
      string,
      unknown,
      { jobId?: string },
    ];
    expect(queue).toBeDefined();
    expect(name).toBe(JOB_NAMES.ingestDrain);
    expect(payload).toEqual({
      source: 'snmp',
      tenantId: 'tenant-worker',
      ingestId: 'ing-1',
    });
    // The stable job id is what makes the drain at-least-once instead of
    // at-least-twice: the same trap is never ingested twice.
    expect(options.jobId).toBe(ingestDrainJobId('snmp', 'ing-1'));
  });

  it('enqueues the job on the ingest queue', async () => {
    startWorkerSnmpReceiver({ env: ENV_ENABLED });

    receiverOptions().onEvent?.(telemetryEvent());
    await flush();

    expect(mocks.createJobQueue).toHaveBeenCalledTimes(1);
    expect(mocks.createJobQueue.mock.calls[0]?.[0]).toBe('ingest');
  });

  it('does not enqueue anything when the spool refused the trap', async () => {
    mocks.spoolSnmpTrap.mockReturnValue(null);
    startWorkerSnmpReceiver({ env: ENV_ENABLED });

    receiverOptions().onEvent?.(telemetryEvent());
    await flush();

    expect(mocks.enqueueJob).not.toHaveBeenCalled();
  });

  it('keeps the raw evidence in its own store, out of the spool', () => {
    startWorkerSnmpReceiver({ env: ENV_ENABLED });

    const envelope = { evidenceId: 'ev-1' };
    receiverOptions().onEvidence?.(envelope);

    // The evidence is forensics, not a dashboard event: it has its own
    // lifecycle and it never goes through the ingest spool.
    expect(mocks.storeEvidence).toHaveBeenCalledTimes(1);
    expect(mocks.storeEvidence.mock.calls[0]?.[1]).toBe(envelope);
    expect(mocks.spoolSnmpTrap).not.toHaveBeenCalled();
  });

  it('reports the failure in the health registry when the queue is down', async () => {
    mocks.enqueueJob.mockRejectedValue(new Error('redis is down'));
    startWorkerSnmpReceiver({ env: ENV_ENABLED });

    receiverOptions().onEvent?.(telemetryEvent());
    await flush();

    const lastError = snapshotHealth()['snmp']?.lastError ?? '';
    expect(lastError).toMatch(/enqueue failed.*redis is down/i);
  });

  it('keeps the receiver alive when the queue is down', async () => {
    mocks.enqueueJob.mockRejectedValue(new Error('redis is down'));
    startWorkerSnmpReceiver({ env: ENV_ENABLED });

    receiverOptions().onEvent?.(telemetryEvent());
    await flush();

    // The next trap is still received and still enqueued: the failure of one
    // enqueue does not take the socket down. The event is already safe on
    // disk.
    receiverOptions().onEvent?.(telemetryEvent());
    await flush();

    expect(mocks.enqueueJob).toHaveBeenCalledTimes(2);
  });

  it('closes the queue when the receiver stops', async () => {
    const handle = startWorkerSnmpReceiver({ env: ENV_ENABLED });
    receiverOptions().onEvent?.(telemetryEvent());
    await flush();

    await handle.stop();

    expect(mocks.closeQueue).toHaveBeenCalledTimes(1);
  });
});
