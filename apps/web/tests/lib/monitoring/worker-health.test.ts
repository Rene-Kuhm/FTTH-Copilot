import { describe, expect, it } from 'vitest';
import {
  WORKER_HEALTH_KEY,
  buildWorkerHealthSnapshot,
  type ServiceHealth,
} from '@ftth-copilot/scheduler';
import { readWorkerHealthWith } from '@/lib/monitoring/worker-health';

/**
 * The web reads the state of the loops from the worker.
 *
 * In worker mode the loops run in the worker, and the health endpoint is
 * served by the web: the web cannot read the registry of the worker from
 * its memory. The worker publishes it in Redis and the web reads it from
 * there.
 */
describe('worker health reader', () => {
  const polling: ServiceHealth = {
    expected: true,
    lastRunAt: 1_700_000_000_000,
    lastError: null,
    lastErrorAt: null,
  };

  it('waits for the connection before reading', async () => {
    const order: string[] = [];
    await readWorkerHealthWith({
      ensureReady: async () => {
        order.push('ready');
      },
      get: async () => {
        order.push('get');
        return null;
      },
    });

    expect(order).toEqual(['ready', 'get']);
  });

  it('returns null when the connection never comes up', async () => {
    const published = JSON.stringify(buildWorkerHealthSnapshot({ polling }, {}, 1_700_000_000_000));
    const snapshot = await readWorkerHealthWith({
      ensureReady: async () => {
        throw new Error('Redis no estuvo lista a tiempo');
      },
      get: async () => published,
    });

    expect(snapshot).toBeNull();
  });

  it('reads the snapshot that the worker published', async () => {
    const published = JSON.stringify(
      buildWorkerHealthSnapshot({ polling }, { backlog: 2 }, 1_700_000_000_000),
    );
    const snapshot = await readWorkerHealthWith({
      get: async () => published,
    });

    expect(snapshot?.services['polling']).toEqual(polling);
    expect(snapshot?.counters).toEqual({ backlog: 2 });
  });

  it('reads the key of the contract', async () => {
    const keys: string[] = [];
    await readWorkerHealthWith({
      get: async (key) => {
        keys.push(key);
        return null;
      },
    });

    expect(keys).toEqual([WORKER_HEALTH_KEY]);
  });

  it('returns null when the worker published nothing', async () => {
    const snapshot = await readWorkerHealthWith({ get: async () => null });
    expect(snapshot).toBeNull();
  });

  it('returns null when the published value is not a snapshot', async () => {
    const snapshot = await readWorkerHealthWith({ get: async () => 'corrupto' });
    expect(snapshot).toBeNull();
  });

  it('returns null instead of failing when Redis is unreachable', async () => {
    const snapshot = await readWorkerHealthWith({
      get: async () => {
        throw new Error('ECONNREFUSED');
      },
    });

    expect(snapshot).toBeNull();
  });
});
