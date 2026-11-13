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
    expect(options.host).toBe('cache');
    expect(options.port).toBe(6379);
    expect(options.tls).toBeUndefined();
    expect(options.maxRetriesPerRequest).toBeNull();
  });

  it('parses rediss:// URLs with auth token and TLS for ElastiCache', () => {
    const options = workerRedisConnectionOptions({
      REDIS_URL: 'rediss://:auth-token@master.ftth.use1.cache.amazonaws.com:6379/2',
    });
    expect(options.host).toBe('master.ftth.use1.cache.amazonaws.com');
    expect(options.port).toBe(6379);
    expect(options.password).toBe('auth-token');
    expect(options.db).toBe(2);
    expect(options.tls).toEqual({});
    expect(options.maxRetriesPerRequest).toBeNull();
  });

  it('parses rediss:// URLs without auth token and enables TLS', () => {
    const options = workerRedisConnectionOptions({
      REDIS_URL: 'rediss://redis.example.com:6380',
    });
    expect(options.host).toBe('redis.example.com');
    expect(options.port).toBe(6380);
    expect(options.username).toBeUndefined();
    expect(options.password).toBeUndefined();
    expect(options.db).toBeUndefined();
    expect(options.tls).toEqual({});
    expect(options.maxRetriesPerRequest).toBeNull();
  });
});
