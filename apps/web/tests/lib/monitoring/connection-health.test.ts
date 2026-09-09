import { describe, expect, it, beforeEach } from 'vitest';
import {
  __resetConnectionHealth,
  evaluateConnectionHealth,
  recordConnectionError,
  recordConnectionSuccess,
  snapshotConnectionHealth,
  snapshotEvaluatedConnectionHealth,
} from '../../../lib/monitoring/connection-health';

describe('connection-health registry (Fase 2 — 2.6)', () => {
  beforeEach(() => {
    __resetConnectionHealth();
  });

  it('starts empty', () => {
    expect(snapshotConnectionHealth()).toEqual([]);
  });

  it('records a successful tick and clears the last error', () => {
    recordConnectionError('c-1', 'boom', 1000);
    recordConnectionSuccess('c-1', 2000);
    const snap = snapshotConnectionHealth();
    expect(snap).toHaveLength(1);
    expect(snap[0]!.lastRunAt).toBe(2000);
    expect(snap[0]!.lastError).toBeNull();
    expect(snap[0]!.lastErrorAt).toBeNull();
  });

  it('records an error and keeps the last-run timestamp intact', () => {
    recordConnectionSuccess('c-1', 1000);
    recordConnectionError('c-1', 'NMS timeout', 2000);
    const snap = snapshotConnectionHealth();
    expect(snap[0]!.lastRunAt).toBe(1000);
    expect(snap[0]!.lastError).toBe('NMS timeout');
    expect(snap[0]!.lastErrorAt).toBe(2000);
  });

  it('partial failures: keeps per-connection state independent', () => {
    recordConnectionSuccess('c-1', 1000);
    recordConnectionSuccess('c-2', 1100);
    recordConnectionError('c-1', 'NMS timeout', 1200);
    const snap = snapshotConnectionHealth();
    const c1 = snap.find((c) => c.connectionId === 'c-1');
    const c2 = snap.find((c) => c.connectionId === 'c-2');
    expect(c1!.lastError).toBe('NMS timeout');
    expect(c2!.lastError).toBeNull();
  });
});

describe('evaluateConnectionHealth — pure classifier', () => {
  it('returns fresh when there is no observation at all', () => {
    const r = evaluateConnectionHealth(
      {
        connectionId: 'c-1',
        state: 'fresh',
        lastRunAt: null,
        lastError: null,
        lastErrorAt: null,
      },
      1000,
    );
    expect(r).toBe('fresh');
  });

  it('returns error when the last error is recent', () => {
    const r = evaluateConnectionHealth(
      {
        connectionId: 'c-1',
        state: 'healthy',
        lastRunAt: 1000,
        lastError: 'NMS timeout',
        lastErrorAt: 4000,
      },
      5000,
    );
    expect(r).toBe('error');
  });

  it('returns stale when the last successful tick is too old (ciclo colgado)', () => {
    const r = evaluateConnectionHealth(
      {
        connectionId: 'c-1',
        state: 'healthy',
        lastRunAt: 1000,
        lastError: null,
        lastErrorAt: null,
      },
      1000 + 11 * 60 * 1000,
    );
    expect(r).toBe('stale');
  });

  it('returns recovered when an old error was followed by a recent success', () => {
    const r = evaluateConnectionHealth(
      {
        connectionId: 'c-1',
        state: 'healthy',
        lastRunAt: 5000,
        lastError: 'NMS timeout',
        lastErrorAt: 1000, // 4s ago — already outside the 5min window
      },
      5000,
    );
    expect(r).toBe('recovered');
  });

  it('returns healthy when a recent tick succeeded and there is no error', () => {
    const r = evaluateConnectionHealth(
      {
        connectionId: 'c-1',
        state: 'healthy',
        lastRunAt: 4000,
        lastError: null,
        lastErrorAt: null,
      },
      5000,
    );
    expect(r).toBe('healthy');
  });
});

describe('snapshotEvaluatedConnectionHealth — integration', () => {
  beforeEach(() => {
    __resetConnectionHealth();
  });

  it('evaluates every entry in the registry', () => {
    const now = 100_000;
    recordConnectionSuccess('c-1', now - 60_000); // healthy (recent success)
    recordConnectionError('c-2', 'timeout', now - 60_000); // error (error 60s ago, recent)
    recordConnectionSuccess('c-3', now - 60 * 60 * 1000); // stale
    recordConnectionError('c-4', 'old', now - 60 * 60 * 1000);
    recordConnectionSuccess('c-4', now - 1000); // recovered
    const snap = snapshotEvaluatedConnectionHealth(now);
    const states = Object.fromEntries(snap.map((s) => [s.connectionId, s.state]));
    expect(states['c-1']).toBe('healthy');
    expect(states['c-2']).toBe('error');
    expect(states['c-3']).toBe('stale');
    expect(states['c-4']).toBe('recovered');
  });

  it('is idempotent (same registry state → same snapshot)', () => {
    const now = 100_000;
    recordConnectionSuccess('c-1', now - 1000);
    const a = snapshotEvaluatedConnectionHealth(now);
    const b = snapshotEvaluatedConnectionHealth(now);
    expect(a).toEqual(b);
  });
});
