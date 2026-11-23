import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WORKER_HEALTH_KEY,
  buildWorkerHealthSnapshot,
  type ServiceHealth,
} from '@ftth-copilot/scheduler';

interface FakeRedisOptions {
  maxRetriesPerRequest?: number;
  connectTimeout?: number;
  enableOfflineQueue?: boolean;
}

interface FakeRedisInstance {
  readonly url: string;
  readonly options: FakeRedisOptions | undefined;
  status: string;
  get: ReturnType<typeof vi.fn>;
  on: (event: string, listener: (...args: unknown[]) => void) => FakeRedisInstance;
  once: (event: string, listener: (...args: unknown[]) => void) => FakeRedisInstance;
  off: (event: string, listener: (...args: unknown[]) => void) => FakeRedisInstance;
  emit: (event: string, ...args: unknown[]) => boolean;
}

const redisMockState = vi.hoisted(() => ({
  instances: [] as FakeRedisInstance[],
  initialStatus: 'wait',
  getImpl: vi.fn<(key: string) => Promise<string | null>>(),
}));

vi.mock('ioredis', async () => {
  const { EventEmitter } = await import('node:events');

  class FakeRedis extends EventEmitter {
    readonly url: string;
    readonly options: FakeRedisOptions | undefined;
    status: string;
    readonly get = vi.fn((key: string) => redisMockState.getImpl(key));

    constructor(url: string, options?: FakeRedisOptions) {
      super();
      this.url = url;
      this.options = options;
      this.status = redisMockState.initialStatus;
      redisMockState.instances.push(this as unknown as FakeRedisInstance);
    }
  }

  return { default: FakeRedis };
});

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

  it('reads from a custom key when provided', async () => {
    const keys: string[] = [];
    await readWorkerHealthWith(
      {
        get: async (key) => {
          keys.push(key);
          return null;
        },
      },
      'ftth:custom:worker-health',
    );

    expect(keys).toEqual(['ftth:custom:worker-health']);
  });

  it('returns null for malformed JSON or payloads that violate the snapshot schema', async () => {
    const payloads = [
      '{not-json',
      '"plain-string"',
      JSON.stringify({ services: {}, counters: {} }),
      JSON.stringify({ services: {}, counters: { backlog: 'NaN' }, publishedAt: 1_700_000_000_000 }),
    ];

    for (const payload of payloads) {
      const snapshot = await readWorkerHealthWith({ get: async () => payload });
      expect(snapshot).toBeNull();
    }
  });
});

describe('readWorkerHealth', () => {
  const polling: ServiceHealth = {
    expected: true,
    lastRunAt: 1_700_000_000_000,
    lastError: null,
    lastErrorAt: null,
  };
  let originalRedisUrl: string | undefined;

  beforeEach(() => {
    originalRedisUrl = process.env['REDIS_URL'];
    redisMockState.instances.length = 0;
    redisMockState.initialStatus = 'wait';
    redisMockState.getImpl.mockReset();
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalRedisUrl === undefined) {
      delete process.env['REDIS_URL'];
    } else {
      process.env['REDIS_URL'] = originalRedisUrl;
    }
  });

  it('returns null without creating a Redis client when REDIS_URL is unset', async () => {
    delete process.env['REDIS_URL'];
    const { readWorkerHealth } = await import('@/lib/monitoring/worker-health');

    const snapshot = await readWorkerHealth();

    expect(snapshot).toBeNull();
    expect(redisMockState.instances).toHaveLength(0);
  });

  it('returns null without creating a Redis client when REDIS_URL is blank', async () => {
    process.env['REDIS_URL'] = '   ';
    const { readWorkerHealth } = await import('@/lib/monitoring/worker-health');

    const snapshot = await readWorkerHealth();

    expect(snapshot).toBeNull();
    expect(redisMockState.instances).toHaveLength(0);
  });

  it('reads directly and reuses the cached client when Redis status is already ready', async () => {
    process.env['REDIS_URL'] = 'redis://127.0.0.1:6379';
    redisMockState.initialStatus = 'ready';
    const published = JSON.stringify(
      buildWorkerHealthSnapshot({ polling }, { backlog: 3 }, 1_700_000_000_000),
    );
    redisMockState.getImpl.mockResolvedValue(published);

    const { readWorkerHealth } = await import('@/lib/monitoring/worker-health');
    const first = await readWorkerHealth();
    const second = await readWorkerHealth();

    expect(redisMockState.instances).toHaveLength(1);
    expect(redisMockState.instances[0]!.url).toBe('redis://127.0.0.1:6379');
    expect(redisMockState.instances[0]!.options).toEqual({
      maxRetriesPerRequest: 1,
      connectTimeout: 1_000,
      enableOfflineQueue: false,
    });
    expect(first?.counters).toEqual({ backlog: 3 });
    expect(second?.services['polling']).toEqual(polling);
    expect(redisMockState.getImpl).toHaveBeenCalledTimes(2);
    expect(redisMockState.getImpl).toHaveBeenCalledWith(WORKER_HEALTH_KEY);

    // Emitting a client error must not throw because an error listener is attached.
    expect(() => redisMockState.instances[0]!.emit('error', new Error('socket reset'))).not.toThrow();
  });

  it('waits for the ready event when Redis is still connecting and returns the snapshot', async () => {
    process.env['REDIS_URL'] = 'redis://127.0.0.1:6379';
    redisMockState.initialStatus = 'connecting';
    const published = JSON.stringify(
      buildWorkerHealthSnapshot({ polling }, { dropped: 0 }, 1_700_000_000_000),
    );
    redisMockState.getImpl.mockResolvedValue(published);

    const { readWorkerHealth } = await import('@/lib/monitoring/worker-health');
    const pending = readWorkerHealth();

    expect(redisMockState.instances).toHaveLength(1);
    const client = redisMockState.instances[0]!;
    client.status = 'ready';
    client.emit('ready');

    const snapshot = await pending;
    expect(snapshot?.services['polling']).toEqual(polling);
    expect(snapshot?.counters).toEqual({ dropped: 0 });
  });

  it('returns null on initial connection error and allows a subsequent call to retry', async () => {
    process.env['REDIS_URL'] = 'redis://127.0.0.1:6379';
    redisMockState.initialStatus = 'connecting';
    const published = JSON.stringify(
      buildWorkerHealthSnapshot({ polling }, { backlog: 1 }, 1_700_000_000_000),
    );
    redisMockState.getImpl.mockResolvedValue(published);

    const { readWorkerHealth } = await import('@/lib/monitoring/worker-health');
    const firstAttempt = readWorkerHealth();
    const client = redisMockState.instances[0]!;
    client.emit('error', new Error('ECONNREFUSED'));

    expect(await firstAttempt).toBeNull();
    expect(redisMockState.getImpl).not.toHaveBeenCalled();

    const retryAttempt = readWorkerHealth();
    client.status = 'ready';
    client.emit('ready');

    const recovered = await retryAttempt;
    expect(recovered?.counters).toEqual({ backlog: 1 });
    expect(redisMockState.getImpl).toHaveBeenCalledTimes(1);
  });

  it('returns null when Redis does not become ready within the timeout and retries on the next call', async () => {
    vi.useFakeTimers();
    process.env['REDIS_URL'] = 'redis://127.0.0.1:6379';
    redisMockState.initialStatus = 'connecting';
    const published = JSON.stringify(
      buildWorkerHealthSnapshot({ polling }, { backlog: 4 }, 1_700_000_000_000),
    );
    redisMockState.getImpl.mockResolvedValue(published);

    const { readWorkerHealth } = await import('@/lib/monitoring/worker-health');
    const firstAttempt = readWorkerHealth();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(await firstAttempt).toBeNull();
    expect(redisMockState.getImpl).not.toHaveBeenCalled();

    const retryAttempt = readWorkerHealth();
    const client = redisMockState.instances[0]!;
    client.status = 'ready';
    client.emit('ready');

    const recovered = await retryAttempt;
    expect(recovered?.counters).toEqual({ backlog: 4 });
  });
});
