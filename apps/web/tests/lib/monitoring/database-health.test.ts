import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
}));

vi.mock('@ftth-copilot/db', () => ({
  prisma: {
    $queryRaw: mocks.queryRaw,
  },
}));

import { checkDatabaseHealth } from '@/lib/monitoring/database-health';

describe('checkDatabaseHealth', () => {
  beforeEach(() => {
    mocks.queryRaw.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns connected with measured latency when SELECT 1 succeeds', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    mocks.queryRaw.mockImplementation(async () => {
      await vi.advanceTimersByTimeAsync(12);
      return [{ '?column?': 1 }];
    });

    const result = await checkDatabaseHealth(500);

    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      status: 'connected',
      latencyMs: 12,
    });
  });

  it('returns a generic connection error when the query rejects', async () => {
    mocks.queryRaw.mockRejectedValue(new Error('ECONNREFUSED 127.0.0.1:5432'));

    const result = await checkDatabaseHealth(500);

    expect(result.status).toBe('error');
    expect(result.error).toBe('Database connection error');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('returns a timeout error when the query exceeds timeoutMs', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    mocks.queryRaw.mockImplementation(() => new Promise<unknown>(() => undefined));

    const checkPromise = checkDatabaseHealth(250);
    await vi.advanceTimersByTimeAsync(250);
    const result = await checkPromise;

    expect(result).toEqual({
      status: 'error',
      latencyMs: 250,
      error: 'Database check timed out',
    });
  });
});
