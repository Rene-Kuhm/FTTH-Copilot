import { describe, expect, it } from 'vitest';
import {
  createStandardTopologyEdges,
  makeEvent,
  DEFAULT_CORRELATION_CONFIG,
  TENANT_A,
  TENANT_B,
} from './fixtures/topology-correlation-fixtures';
import { correlateByTopologyAndTime } from '../src/topology-correlation';
import type { TopologyCorrelationConfig } from '@ftth-copilot/shared';

describe('correlateByTopologyAndTime — Deterministic Topology & Time Rules (Fase 4.1)', () => {
  const edges = createStandardTopologyEdges(TENANT_A);

  it('groups multiple affected ONUs under same CTO when count and ratio thresholds are met', () => {
    const events = [
      makeEvent('ONU-1', '2026-09-09T10:00:00.000Z'),
      makeEvent('ONU-2', '2026-09-09T10:01:00.000Z'),
      makeEvent('ONU-3', '2026-09-09T10:02:00.000Z'),
    ];

    const groups = correlateByTopologyAndTime(events, edges, DEFAULT_CORRELATION_CONFIG);

    expect(groups).toHaveLength(1);
    const group = groups[0]!;
    expect(group.ancestorKind).toBe('CTO');
    expect(group.ancestorId).toBe('CTO-1');
    expect(group.affectedCount).toBe(3);
    expect(group.totalPopulation).toBe(4);
    expect(group.affectedRatio).toBe(0.75);
    expect(group.affectedDeviceIds).toEqual(['ONU-1', 'ONU-2', 'ONU-3']);
    expect(group.healthyDeviceIds).toEqual(['ONU-4']);
    expect(group.windowStart).toBe('2026-09-09T10:00:00.000Z');
    expect(group.windowEnd).toBe('2026-09-09T10:02:00.000Z');
    expect(group.hypothesisSupport).toContain('CTO-1');
  });

  it('does not create a group when affected count is below minAffectedCount', () => {
    // Only 2 ONUs fail, but config requires 3
    const events = [
      makeEvent('ONU-1', '2026-09-09T10:00:00.000Z'),
      makeEvent('ONU-2', '2026-09-09T10:01:00.000Z'),
    ];

    const groups = correlateByTopologyAndTime(events, edges, {
      ...DEFAULT_CORRELATION_CONFIG,
      minAffectedCount: 3,
    });

    expect(groups).toHaveLength(0);
  });

  it('does not create a group when affected ratio is below minAffectedRatio', () => {
    // 3 ONUs fail out of 4 (ratio 0.75), but config requires ratio >= 0.8
    const events = [
      makeEvent('ONU-1', '2026-09-09T10:00:00.000Z'),
      makeEvent('ONU-2', '2026-09-09T10:01:00.000Z'),
      makeEvent('ONU-3', '2026-09-09T10:02:00.000Z'),
    ];

    const groups = correlateByTopologyAndTime(events, edges, {
      ...DEFAULT_CORRELATION_CONFIG,
      minAffectedRatio: 0.8,
    });

    expect(groups).toHaveLength(0);
  });

  it('escalates to Splitter when failures affect multiple CTOs under that Splitter', () => {
    // 2 ONUs on CTO-1 (ONU-1, ONU-2) and 2 ONUs on CTO-2 (ONU-5, ONU-6)
    // CTO-1 has 2/4 (count < 4)
    // CTO-2 has 2/4 (count < 4)
    // SPL-1 has 4/8 = 0.5 (count >= 4, ratio >= 0.5)
    const events = [
      makeEvent('ONU-1', '2026-09-09T10:00:00.000Z'),
      makeEvent('ONU-2', '2026-09-09T10:00:30.000Z'),
      makeEvent('ONU-5', '2026-09-09T10:01:00.000Z'),
      makeEvent('ONU-6', '2026-09-09T10:01:30.000Z'),
    ];

    const config: TopologyCorrelationConfig = {
      timeWindowMs: 5 * 60 * 1000,
      minAffectedCount: 4,
      minAffectedRatio: 0.5,
    };

    const groups = correlateByTopologyAndTime(events, edges, config);

    expect(groups).toHaveLength(1);
    const group = groups[0]!;
    expect(group.ancestorKind).toBe('SPLITTER');
    expect(group.ancestorId).toBe('SPL-1');
    expect(group.affectedCount).toBe(4);
    expect(group.totalPopulation).toBe(8);
    expect(group.affectedRatio).toBe(0.5);
    expect(group.affectedDeviceIds).toEqual(['ONU-1', 'ONU-2', 'ONU-5', 'ONU-6']);
    expect(group.healthyDeviceIds).toEqual(['ONU-3', 'ONU-4', 'ONU-7', 'ONU-8']);
  });

  it('prefers the most specific common ancestor (CTO over Splitter/PON) when CTO threshold is satisfied', () => {
    // All 4 ONUs on CTO-1 fail
    const events = [
      makeEvent('ONU-1', '2026-09-09T10:00:00.000Z'),
      makeEvent('ONU-2', '2026-09-09T10:00:30.000Z'),
      makeEvent('ONU-3', '2026-09-09T10:01:00.000Z'),
      makeEvent('ONU-4', '2026-09-09T10:01:30.000Z'),
    ];

    const config: TopologyCorrelationConfig = {
      timeWindowMs: 5 * 60 * 1000,
      minAffectedCount: 3,
      minAffectedRatio: 0.5,
    };

    const groups = correlateByTopologyAndTime(events, edges, config);

    // Should correlate to CTO-1 (most specific), NOT SPL-1 (where ratio would be 4/8=0.5)
    expect(groups).toHaveLength(1);
    expect(groups[0]!.ancestorKind).toBe('CTO');
    expect(groups[0]!.ancestorId).toBe('CTO-1');
    expect(groups[0]!.affectedCount).toBe(4);
    expect(groups[0]!.totalPopulation).toBe(4);
  });

  it('does not falsely group independent simultaneous failures across PON when ratio is low', () => {
    // 2 ONUs on CTO-1 fail and 1 ONU on CTO-4 fail (3 ONUs total out of 16 on PON-1 = 18.75%)
    const events = [
      makeEvent('ONU-1', '2026-09-09T10:00:00.000Z'),
      makeEvent('ONU-2', '2026-09-09T10:00:30.000Z'),
      makeEvent('ONU-13', '2026-09-09T10:01:00.000Z'),
    ];

    const config: TopologyCorrelationConfig = {
      timeWindowMs: 5 * 60 * 1000,
      minAffectedCount: 3,
      minAffectedRatio: 0.4, // requires 40% of population
    };

    const groups = correlateByTopologyAndTime(events, edges, config);

    // Neither CTO meets count: 3
    // Neither Splitter meets count: 3
    // PON meets count: 3, but ratio is 3/16 = 0.1875 < 0.4 -> NO correlation group
    expect(groups).toHaveLength(0);
  });

  it('separates events that fall outside the temporal window', () => {
    // ONU-1 and ONU-2 fail at 10:00, ONU-3 fails at 10:30 (outside 5m window)
    const events = [
      makeEvent('ONU-1', '2026-09-09T10:00:00.000Z'),
      makeEvent('ONU-2', '2026-09-09T10:01:00.000Z'),
      makeEvent('ONU-3', '2026-09-09T10:30:00.000Z'),
    ];

    const groups = correlateByTopologyAndTime(events, edges, {
      ...DEFAULT_CORRELATION_CONFIG,
      minAffectedCount: 3,
    });

    expect(groups).toHaveLength(0);
  });

  it('strictly isolates by tenant (zero cross-tenant contamination)', () => {
    const edgesWithTenantB = [
      ...edges,
      ...createStandardTopologyEdges(TENANT_B),
    ];

    // Events for Tenant A (2 ONUs) + Events for Tenant B (2 ONUs) under same deviceIds
    const events = [
      makeEvent('ONU-1', '2026-09-09T10:00:00.000Z', TENANT_A),
      makeEvent('ONU-2', '2026-09-09T10:01:00.000Z', TENANT_A),
      makeEvent('ONU-1', '2026-09-09T10:00:00.000Z', TENANT_B),
      makeEvent('ONU-2', '2026-09-09T10:01:00.000Z', TENANT_B),
      makeEvent('ONU-3', '2026-09-09T10:02:00.000Z', TENANT_B),
    ];

    // Running for Tenant A with minAffectedCount = 3 should find 0 groups (only 2 events for Tenant A)
    const groupsA = correlateByTopologyAndTime(events, edgesWithTenantB, {
      ...DEFAULT_CORRELATION_CONFIG,
      minAffectedCount: 3,
    }, TENANT_A);

    expect(groupsA).toHaveLength(0);

    // Running for Tenant B should find 1 group with 3 affected ONUs, all belonging strictly to Tenant B
    const groupsB = correlateByTopologyAndTime(events, edgesWithTenantB, {
      ...DEFAULT_CORRELATION_CONFIG,
      minAffectedCount: 3,
    }, TENANT_B);

    expect(groupsB).toHaveLength(1);
    expect(groupsB[0]!.tenantId).toBe(TENANT_B);
  });

  it('is strictly deterministic regardless of event input ordering', () => {
    const eventsForward = [
      makeEvent('ONU-1', '2026-09-09T10:00:00.000Z'),
      makeEvent('ONU-2', '2026-09-09T10:01:00.000Z'),
      makeEvent('ONU-3', '2026-09-09T10:02:00.000Z'),
    ];

    const eventsReversed = [...eventsForward].reverse();

    const groups1 = correlateByTopologyAndTime(eventsForward, edges, DEFAULT_CORRELATION_CONFIG);
    const groups2 = correlateByTopologyAndTime(eventsReversed, edges, DEFAULT_CORRELATION_CONFIG);

    expect(groups1).toEqual(groups2);
  });
});
