import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REDIS_URL,
  redisConnectionOptions,
  redisUrl,
  workerRedisConnectionOptions,
} from '../src/connection';

describe('redisUrl', () => {
  it('reads REDIS_URL', () => {
    expect(redisUrl({ REDIS_URL: 'redis://cache:6379/2' })).toBe('redis://cache:6379/2');
  });

  it('falls back to a local Redis when the variable is empty', () => {
    expect(redisUrl({})).toBe(DEFAULT_REDIS_URL);
    expect(redisUrl({ REDIS_URL: '   ' })).toBe(DEFAULT_REDIS_URL);
  });
});

describe('redisConnectionOptions', () => {
  it('keeps the producer retrying bounded, so a web request fails fast', () => {
    const options = redisConnectionOptions({ REDIS_URL: 'redis://cache:6379' });
    expect(options.url).toBe('redis://cache:6379');
    // A producer that cannot reach Redis has to fail instead of waiting:
    // with the default retry limit a request hangs until its own timeout.
    expect(options.maxRetriesPerRequest).toBe(3);
  });

  it('carries the credentials of the URL', () => {
    const options = redisConnectionOptions({ REDIS_URL: 'redis://:secret@cache:6379' });
    expect(options.url).toBe('redis://:secret@cache:6379');
  });
});

describe('workerRedisConnectionOptions', () => {
  it('disables the retry limit, which BullMQ requires for workers', () => {
    const options = workerRedisConnectionOptions({ REDIS_URL: 'redis://cache:6379' });
    expect(options.url).toBe('redis://cache:6379');
    expect(options.maxRetriesPerRequest).toBeNull();
  });
});
