import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * In-process loop starters.
 *
 * New coverage for the code that moved to `@ftth-copilot/scheduler`: the web
 * still owns the in-process loops until the `BACKEND_MODE=worker` cut-over
 * (task T8), so the env gate, the cadence and the disposer are part of the
 * package's contract.
 */

const mocks = vi.hoisted(() => ({
  prismaNmsConnectionFindMany: vi.fn(),
  queryRaw: vi.fn(),
  buildConnectorFromConnection: vi.fn(),
  pollConnections: vi.fn(),
}));

vi.mock('@ftth-copilot/db', () => ({
  prisma: {
    nmsConnection: { findMany: mocks.prismaNmsConnectionFindMany },
    $transaction: async (fn: (tx: unknown) => unknown) =>
      fn({ $queryRaw: mocks.queryRaw }),
  },
  decryptApiKey: vi.fn(),
}));

vi.mock('@ftth-copilot/connectors-factory', () => ({
  buildConnectorFromConnection: mocks.buildConnectorFromConnection,
}));

vi.mock('@ftth-copilot/monitoring', () => ({
  pollConnections: mocks.pollConnections,
}));

import {
  __clearSchedulerState,
  snapshotHealth,
  startFecCollectionLoop,
  startFirmwareAuditLoop,
  startPollingLoop,
} from '../src/index';

const ENV_KEYS = [
  'METRICS_POLLER_ENABLED',
  'METRICS_POLL_INTERVAL_MS',
  'FIRMWARE_AUDIT_ENABLED',
  'FIRMWARE_AUDIT_INTERVAL_MS',
  'FEC_COLLECTION_ENABLED',
  'FEC_COLLECTION_INTERVAL_MS',
] as const;

function clearEnv(): void {
  for (const key of ENV_KEYS) delete process.env[key];
}

beforeEach(() => {
  clearEnv();
  __clearSchedulerState();
  vi.useFakeTimers();
  mocks.queryRaw.mockResolvedValue([{ locked: true }]);
  mocks.prismaNmsConnectionFindMany.mockResolvedValue([]);
  mocks.pollConnections.mockResolvedValue({ results: [], errors: [], deleted: 0 });
});

afterEach(() => {
  vi.useRealTimers();
  clearEnv();
  __clearSchedulerState();
  vi.restoreAllMocks();
});

describe('startPollingLoop', () => {
  it('does not schedule anything when METRICS_POLLER_ENABLED is not "true"', () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');

    const cleanup = startPollingLoop();

    expect(typeof cleanup).toBe('function');
    expect(setIntervalSpy).not.toHaveBeenCalled();
    expect(snapshotHealth()['polling']?.expected).toBe(false);
    cleanup();
  });

  it('registers the default cadence and a warm-up run when enabled', () => {
    process.env['METRICS_POLLER_ENABLED'] = 'true';
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    const cleanup = startPollingLoop();

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(setIntervalSpy.mock.calls[0]?.[1]).toBe(900_000);
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 5000);
    expect(snapshotHealth()['polling']?.expected).toBe(true);
    cleanup();
  });

  it('honours METRICS_POLL_INTERVAL_MS', () => {
    process.env['METRICS_POLLER_ENABLED'] = 'true';
    process.env['METRICS_POLL_INTERVAL_MS'] = '1234';
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');

    startPollingLoop();

    expect(setIntervalSpy.mock.calls[0]?.[1]).toBe(1234);
  });

  it('clears the interval and the warm-up on dispose', () => {
    process.env['METRICS_POLLER_ENABLED'] = 'true';
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

    const cleanup = startPollingLoop();
    cleanup();

    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
  });

  it('runs the tick when the interval fires and when the warm-up fires', async () => {
    process.env['METRICS_POLLER_ENABLED'] = 'true';
    process.env['METRICS_POLL_INTERVAL_MS'] = '30000';

    const cleanup = startPollingLoop();

    // The warm-up tick (5s after boot) and the first interval tick (30s).
    await vi.advanceTimersByTimeAsync(31000);

    expect(mocks.pollConnections).toHaveBeenCalledTimes(2);
    cleanup();
  });
});

describe('startFirmwareAuditLoop', () => {
  it('does not schedule anything when FIRMWARE_AUDIT_ENABLED is not "true"', () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');

    const cleanup = startFirmwareAuditLoop();

    expect(setIntervalSpy).not.toHaveBeenCalled();
    expect(snapshotHealth()['firmware']?.expected).toBe(false);
    cleanup();
  });

  it('registers the 24h default cadence when enabled', () => {
    process.env['FIRMWARE_AUDIT_ENABLED'] = 'true';
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');

    const cleanup = startFirmwareAuditLoop();

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(setIntervalSpy.mock.calls[0]?.[1]).toBe(86_400_000);
    expect(snapshotHealth()['firmware']?.expected).toBe(true);
    cleanup();
  });

  it('runs the audit tick when the warm-up fires', async () => {
    process.env['FIRMWARE_AUDIT_ENABLED'] = 'true';

    const cleanup = startFirmwareAuditLoop();

    await vi.advanceTimersByTimeAsync(5000);

    // The audit ran: it queried the connections of the tenant.
    expect(mocks.prismaNmsConnectionFindMany).toHaveBeenCalled();
    cleanup();
  });
});

describe('startFecCollectionLoop', () => {
  it('does not schedule anything when FEC_COLLECTION_ENABLED is not "true"', () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');

    const cleanup = startFecCollectionLoop();

    expect(setIntervalSpy).not.toHaveBeenCalled();
    expect(snapshotHealth()['fec']?.expected).toBe(false);
    cleanup();
  });

  it('registers the 1h default cadence when enabled', () => {
    process.env['FEC_COLLECTION_ENABLED'] = 'true';
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');

    const cleanup = startFecCollectionLoop();

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(setIntervalSpy.mock.calls[0]?.[1]).toBe(3_600_000);
    expect(snapshotHealth()['fec']?.expected).toBe(true);
    cleanup();
  });

  it('runs the collection tick when the warm-up fires', async () => {
    process.env['FEC_COLLECTION_ENABLED'] = 'true';

    const cleanup = startFecCollectionLoop();

    await vi.advanceTimersByTimeAsync(5000);

    expect(mocks.prismaNmsConnectionFindMany).toHaveBeenCalled();
    cleanup();
  });
});
