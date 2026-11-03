import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  WORKER_HEALTH_KEY,
  WORKER_HEALTH_TTL_SECONDS,
  parseWorkerHealthSnapshot,
  type ServiceHealth,
} from '@ftth-copilot/scheduler';
import { createHealthPublisher, startHealthPublisher } from '../src/health-publisher';

/**
 * The worker publishes the state of its loops.
 *
 * The web cannot read the registry from the memory of the worker: the
 * process that runs the loops is not the process that serves the health
 * endpoint. The snapshot travels through Redis, and this suite pins what the
 * worker puts there.
 */
describe('worker health publisher', () => {
  const polling: ServiceHealth = {
    expected: true,
    lastRunAt: 1_700_000_000_000,
    lastError: null,
    lastErrorAt: null,
  };

  /** A Redis client that records what it was asked to write. */
  function recordingClient(): {
    client: { set: (key: string, value: string, mode: 'EX', ttl: number) => Promise<unknown> };
    writes: Array<{ key: string; value: string; mode: string; ttl: number }>;
  } {
    const writes: Array<{ key: string; value: string; mode: string; ttl: number }> = [];
    return {
      writes,
      client: {
        set: async (key, value, mode, ttl) => {
          writes.push({ key, value, mode, ttl });
          return 'OK';
        },
      },
    };
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it('writes the snapshot under the key of the contract', async () => {
    const { client, writes } = recordingClient();
    const publisher = createHealthPublisher({ client, services: () => ({ polling }) });

    expect(await publisher.publish()).toBe(true);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.key).toBe(WORKER_HEALTH_KEY);
  });

  it('writes it with an expiry so a dead worker leaves no green trace', async () => {
    const { client, writes } = recordingClient();
    const publisher = createHealthPublisher({ client, services: () => ({ polling }) });

    await publisher.publish();
    expect(writes[0]?.mode).toBe('EX');
    expect(writes[0]?.ttl).toBe(WORKER_HEALTH_TTL_SECONDS);
  });

  it('publishes the state of the loops', async () => {
    const { client, writes } = recordingClient();
    const publisher = createHealthPublisher({ client, services: () => ({ polling }) });

    await publisher.publish();
    const parsed = parseWorkerHealthSnapshot(writes[0]?.value ?? null);
    expect(parsed?.services['polling']).toEqual(polling);
  });

  it('publishes the counters of the ingest path of the worker', async () => {
    const { client, writes } = recordingClient();
    const publisher = createHealthPublisher({
      client,
      services: () => ({ polling }),
      counters: () => ({ backlog: 7, dropped: 0 }),
    });

    await publisher.publish();
    const parsed = parseWorkerHealthSnapshot(writes[0]?.value ?? null);
    expect(parsed?.counters).toEqual({ backlog: 7, dropped: 0 });
  });

  it('reports a failure instead of throwing when Redis is unreachable', async () => {
    const client = {
      set: async (): Promise<unknown> => {
        throw new Error('ECONNREFUSED');
      },
    };
    const publisher = createHealthPublisher({ client, services: () => ({ polling }) });

    expect(await publisher.publish()).toBe(false);
  });

  it('keeps publishing on its own until it is stopped', async () => {
    vi.useFakeTimers();
    const { client, writes } = recordingClient();
    const handle = startHealthPublisher({
      client,
      services: () => ({ polling }),
      intervalMs: 20_000,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(writes).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(20_000);
    expect(writes).toHaveLength(2);

    handle.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(writes).toHaveLength(2);
  });
});
