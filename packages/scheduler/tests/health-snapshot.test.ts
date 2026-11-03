import { describe, expect, it } from 'vitest';
import {
  WORKER_HEALTH_KEY,
  WORKER_HEALTH_TTL_SECONDS,
  buildWorkerHealthSnapshot,
  parseWorkerHealthSnapshot,
  type ServiceHealth,
} from '../src/index';

/**
 * The contract of the health snapshot that the worker publishes.
 *
 * The registry of the loops lives in the memory of the process that runs
 * them. When that process is the worker, the web cannot see it: Next.js
 * bundles the instrumentation and the route handlers separately, so the web
 * would read a *different* copy of the registry — an empty one. The state
 * has to travel through a channel both processes share.
 *
 * The channel is Redis: the worker writes the snapshot, the web reads it.
 * This module pins the shape of what travels, so both ends agree without
 * either of them knowing how the other is implemented.
 */
describe('worker health snapshot contract', () => {
  const polling: ServiceHealth = {
    expected: true,
    lastRunAt: 1_700_000_000_000,
    lastError: null,
    lastErrorAt: null,
  };

  it('uses a namespaced key so it does not collide with another consumer of the Redis', () => {
    expect(WORKER_HEALTH_KEY).toBe('ftth:worker:scheduler-health');
    expect(WORKER_HEALTH_KEY.startsWith('ftth:')).toBe(true);
  });

  it('expires the snapshot so a dead worker does not leave a green trace behind', () => {
    expect(WORKER_HEALTH_TTL_SECONDS).toBeGreaterThan(0);
    expect(WORKER_HEALTH_TTL_SECONDS).toBeLessThanOrEqual(300);
  });

  it('builds the snapshot from the services and the time of publication', () => {
    const snapshot = buildWorkerHealthSnapshot({ polling }, {}, 1_700_000_000_000);
    expect(snapshot).toEqual({
      services: { polling },
      counters: {},
      publishedAt: 1_700_000_000_000,
    });
  });

  it('carries the counters of the ingest path', () => {
    const snapshot = buildWorkerHealthSnapshot(
      { polling },
      { backlog: 12, dropped: 0 },
      1_700_000_000_000,
    );
    expect(snapshot.counters).toEqual({ backlog: 12, dropped: 0 });
  });

  it('parses a snapshot that the worker published', () => {
    const published = JSON.stringify(
      buildWorkerHealthSnapshot({ polling }, { backlog: 3 }, 1_700_000_000_000),
    );
    expect(parseWorkerHealthSnapshot(published)).toEqual({
      services: { polling },
      counters: { backlog: 3 },
      publishedAt: 1_700_000_000_000,
    });
  });

  it('keeps the optional bound flag of the syslog and snmp sockets', () => {
    const syslog: ServiceHealth = { ...polling, bound: true };
    const published = JSON.stringify(
      buildWorkerHealthSnapshot({ syslog }, {}, 1_700_000_000_000),
    );
    expect(parseWorkerHealthSnapshot(published)?.services['syslog']?.bound).toBe(true);
  });

  it('returns null when the worker published nothing', () => {
    expect(parseWorkerHealthSnapshot(null)).toBeNull();
  });

  it('returns null when the published value is not JSON', () => {
    expect(parseWorkerHealthSnapshot('not json')).toBeNull();
  });

  it('returns null when the published value has no services', () => {
    expect(parseWorkerHealthSnapshot(JSON.stringify({ publishedAt: 1 }))).toBeNull();
  });

  it('returns null when the services are not an object', () => {
    expect(parseWorkerHealthSnapshot(JSON.stringify({ services: [], publishedAt: 1 }))).toBeNull();
  });

  it('returns null when a counter is not a number', () => {
    const broken = JSON.stringify({ services: {}, counters: { backlog: 'muchos' }, publishedAt: 1 });
    expect(parseWorkerHealthSnapshot(broken)).toBeNull();
  });

  it('returns null when a service does not have the expected shape', () => {
    const broken = JSON.stringify({
      services: { polling: { expected: 'yes', lastRunAt: null, lastError: null, lastErrorAt: null } },
      publishedAt: 1,
    });
    expect(parseWorkerHealthSnapshot(broken)).toBeNull();
  });

  it('returns null when a timestamp is not a number', () => {
    const broken = JSON.stringify({
      services: { polling: { expected: true, lastRunAt: 'ayer', lastError: null, lastErrorAt: null } },
      publishedAt: 1,
    });
    expect(parseWorkerHealthSnapshot(broken)).toBeNull();
  });

  it('returns null when the publication time is not a number', () => {
    const broken = JSON.stringify({ services: {}, publishedAt: 'ahora' });
    expect(parseWorkerHealthSnapshot(broken)).toBeNull();
  });
});
