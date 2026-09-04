/**
 * P1.3 — injection_suspicion_total metric tests.
 *
 * Contract under test (AD-11):
 *   `computeInjectionSuspicionTotal` counts verdict-log entries where
 *   `injectionSuspicion === true` and aggregates them by tenant and by
 *   verdict code. Entries without the field or with `false` are excluded.
 *
 * RED proof: before `computeInjectionSuspicionTotal` exists in
 * `src/metrics.ts`, the named export resolves to `undefined` and every
 * assertion below fails.
 *
 * GREEN proof: after the function ships, the suite passes with the
 * exact semantics from design.md §Architecture Decisions #11.
 */
import { describe, expect, it } from 'vitest';
import {
  computeInjectionSuspicionTotal,
  type VerdictLogEntry,
} from '../src/metrics';

function entry(
  overrides: Partial<VerdictLogEntry> & Pick<VerdictLogEntry, 'tenantId' | 'code'>,
): VerdictLogEntry {
  return { ...overrides };
}

describe('@ftth-copilot/eval — computeInjectionSuspicionTotal (AD-11)', () => {
  it('returns total 0 for an empty array', () => {
    const result = computeInjectionSuspicionTotal([]);
    expect(result.total).toBe(0);
    expect(result.byTenant).toEqual({});
    expect(result.byCode).toEqual({});
  });

  it('returns total 0 when no entry has injectionSuspicion=true', () => {
    const entries: VerdictLogEntry[] = [
      entry({ tenantId: 't1', code: 'ok', injectionSuspicion: false }),
      entry({ tenantId: 't1', code: 'incomplete', injectionSuspicion: false }),
    ];
    const result = computeInjectionSuspicionTotal(entries);
    expect(result.total).toBe(0);
    expect(result.byTenant).toEqual({});
    expect(result.byCode).toEqual({});
  });

  it('counts entries where injectionSuspicion=true', () => {
    const entries: VerdictLogEntry[] = [
      entry({ tenantId: 't1', code: 'stale', injectionSuspicion: true }),
      entry({ tenantId: 't1', code: 'stale', injectionSuspicion: true }),
      entry({ tenantId: 't2', code: 'low_confidence', injectionSuspicion: true }),
    ];
    const result = computeInjectionSuspicionTotal(entries);
    expect(result.total).toBe(3);
  });

  it('excludes entries without an injectionSuspicion field', () => {
    const entries: VerdictLogEntry[] = [
      entry({ tenantId: 't1', code: 'stale' }), // no injectionSuspicion
      entry({ tenantId: 't1', code: 'stale', injectionSuspicion: true }),
    ];
    const result = computeInjectionSuspicionTotal(entries);
    expect(result.total).toBe(1);
  });

  it('groups counts by tenant', () => {
    const entries: VerdictLogEntry[] = [
      entry({ tenantId: 'alpha', code: 'stale', injectionSuspicion: true }),
      entry({ tenantId: 'alpha', code: 'stale', injectionSuspicion: true }),
      entry({ tenantId: 'beta', code: 'low_confidence', injectionSuspicion: true }),
      entry({ tenantId: 'alpha', code: 'ok', injectionSuspicion: false }),
    ];
    const result = computeInjectionSuspicionTotal(entries);
    expect(result.byTenant).toEqual({ alpha: 2, beta: 1 });
  });

  it('groups counts by code', () => {
    const entries: VerdictLogEntry[] = [
      entry({ tenantId: 't1', code: 'stale', injectionSuspicion: true }),
      entry({ tenantId: 't2', code: 'stale', injectionSuspicion: true }),
      entry({ tenantId: 't1', code: 'low_confidence', injectionSuspicion: true }),
    ];
    const result = computeInjectionSuspicionTotal(entries);
    expect(result.byCode).toEqual({ stale: 2, low_confidence: 1 });
  });

  it('handles mixed tenants and codes correctly', () => {
    const entries: VerdictLogEntry[] = [
      entry({ tenantId: 'alpha', code: 'stale', injectionSuspicion: true }),
      entry({ tenantId: 'alpha', code: 'low_confidence', injectionSuspicion: true }),
      entry({ tenantId: 'beta', code: 'stale', injectionSuspicion: true }),
      entry({ tenantId: 'beta', code: 'ok', injectionSuspicion: false }),
      entry({ tenantId: 'gamma', code: 'incomplete' }), // no field
    ];
    const result = computeInjectionSuspicionTotal(entries);
    expect(result.total).toBe(3);
    expect(result.byTenant).toEqual({ alpha: 2, beta: 1 });
    expect(result.byCode).toEqual({ stale: 2, low_confidence: 1 });
  });

  it('treats undefined injectionSuspicion the same as false', () => {
    const entriesWithUndefined: VerdictLogEntry[] = [
      entry({ tenantId: 't1', code: 'stale', injectionSuspicion: undefined }),
    ];
    const entriesWithout: VerdictLogEntry[] = [
      entry({ tenantId: 't1', code: 'stale' }),
    ];
    expect(computeInjectionSuspicionTotal(entriesWithUndefined).total).toBe(0);
    expect(computeInjectionSuspicionTotal(entriesWithout).total).toBe(0);
  });
});
