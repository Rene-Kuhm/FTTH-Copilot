import { describe, expect, it, vi, beforeEach } from 'vitest';
import { JOB_NAMES, ingestDrainJobId } from '@ftth-copilot/jobs';
import { __resetSchedulerHealth, snapshotHealth } from '@ftth-copilot/scheduler';

/**
 * The syslog receiver of the worker.
 *
 * The worker binds the socket, spools every datagram into the durable spool
 * and enqueues a drain job. This spec pins the wiring: the job name, the
 * payload and the stable job id, plus what happens when the queue is down.
 *
 * The queue and the receiver are mocked: the vocabulary of the queue (the job
 * name and the job id) is the real one, so the assertions are about the
 * contract and not about a mock.
 */
const mocks = vi.hoisted(() => ({
  createJobQueue: vi.fn(),
  enqueueJob: vi.fn(),
  startSyslogReceiver: vi.fn(),
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
  startSyslogReceiver: mocks.startSyslogReceiver,
}));

import { startWorkerSyslogReceiver } from '../src/syslog';

/** The options the worker handed to the receiver. */
function receiverOptions(): { onEventSpooled?: (ingestId: string | null) => void } {
  const call = mocks.startSyslogReceiver.mock.calls[0];
  return (call?.[0] ?? {}) as { onEventSpooled?: (ingestId: string | null) => void };
}

/** Lets the pending enqueue settle. */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

const ENV_ENABLED = {
  SYSLOG_RECEIVER_ENABLED: 'true',
  SYSLOG_TENANT_ID: 'tenant-worker',
};

beforeEach(() => {
  vi.clearAllMocks();
  // The health registry is process-wide: each test starts from a clean one.
  __resetSchedulerHealth();
  mocks.createJobQueue.mockReturnValue({ close: mocks.closeQueue, on: mocks.onQueue });
  mocks.enqueueJob.mockResolvedValue({ id: 'job-1' });
  mocks.startSyslogReceiver.mockReturnValue(() => {});
});

describe('the worker syslog receiver', () => {
  it('starts the receiver of the package', () => {
    startWorkerSyslogReceiver({ env: ENV_ENABLED });

    expect(mocks.startSyslogReceiver).toHaveBeenCalledTimes(1);
  });

  it('does not start the in-process drainer: the worker drains through the queue', () => {
    startWorkerSyslogReceiver({ env: ENV_ENABLED });

    const options = mocks.startSyslogReceiver.mock.calls[0]?.[0] as {
      startInProcessDrainer?: boolean;
    };
    expect(options.startInProcessDrainer).toBe(false);
  });

  it('enqueues a drain job for every spooled event', async () => {
    startWorkerSyslogReceiver({ env: ENV_ENABLED });

    receiverOptions().onEventSpooled?.('ing-1');
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
    expect(payload).toEqual({ source: 'syslog', tenantId: 'tenant-worker', ingestId: 'ing-1' });
    // The stable job id is what makes the drain at-least-once instead of
    // at-least-twice.
    expect(options.jobId).toBe(ingestDrainJobId('syslog', 'ing-1'));
  });

  it('enqueues the job on the ingest queue', async () => {
    startWorkerSyslogReceiver({ env: ENV_ENABLED });

    receiverOptions().onEventSpooled?.('ing-1');
    await flush();

    expect(mocks.createJobQueue).toHaveBeenCalledTimes(1);
    expect(mocks.createJobQueue.mock.calls[0]?.[0]).toBe('ingest');
  });

  it('does not enqueue anything when the spool refused the event', async () => {
    startWorkerSyslogReceiver({ env: ENV_ENABLED });

    receiverOptions().onEventSpooled?.(null);
    await flush();

    expect(mocks.enqueueJob).not.toHaveBeenCalled();
  });

  it('reports the failure in the health registry when the queue is down', async () => {
    mocks.enqueueJob.mockRejectedValue(new Error('redis is down'));
    startWorkerSyslogReceiver({ env: ENV_ENABLED });

    receiverOptions().onEventSpooled?.('ing-1');
    await flush();

    const lastError = snapshotHealth()['syslog']?.lastError ?? '';
    expect(lastError).toMatch(/enqueue failed.*redis is down/i);
  });

  it('reports the failure in the health registry when the queue cannot connect', async () => {
    startWorkerSyslogReceiver({ env: ENV_ENABLED });

    receiverOptions().onEventSpooled?.('ing-1');
    await flush();

    // The connection error of the queue: the enqueue is still waiting for it,
    // and the operator has to see the outage before the backlog grows.
    const onError = mocks.onQueue.mock.calls[0]?.[1] as (error: Error) => void;
    onError(new Error('connect ECONNREFUSED 127.0.0.1:6379'));

    const lastError = snapshotHealth()['syslog']?.lastError ?? '';
    expect(lastError).toMatch(/enqueue failed.*ECONNREFUSED/i);
  });

  it('keeps the receiver alive when the queue is down', async () => {
    mocks.enqueueJob.mockRejectedValue(new Error('redis is down'));
    startWorkerSyslogReceiver({ env: ENV_ENABLED });

    receiverOptions().onEventSpooled?.('ing-1');
    await flush();

    // The next datagram is still received and still enqueued: the failure of
    // one enqueue does not take the socket down.
    receiverOptions().onEventSpooled?.('ing-2');
    await flush();

    expect(mocks.enqueueJob).toHaveBeenCalledTimes(2);
  });

  it('closes the queue when the receiver stops', async () => {
    const handle = startWorkerSyslogReceiver({ env: ENV_ENABLED });
    receiverOptions().onEventSpooled?.('ing-1');
    await flush();

    await handle.stop();

    expect(mocks.closeQueue).toHaveBeenCalledTimes(1);
  });
});
