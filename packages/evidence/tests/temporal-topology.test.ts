import { describe, expect, it } from 'vitest';
import type { TopologyEdge } from '@ftth-copilot/shared';
import {
  isEdgeValidAt,
  bfsAncestors,
  bfsDownstream,
  topologyPath,
} from '../src/topology';
import { correlateByTopologyAndTime } from '../src/topology-correlation';
import { makeEvent, DEFAULT_CORRELATION_CONFIG } from './fixtures/topology-correlation-fixtures';

function makeEdge(
  parentKind: TopologyEdge['parentKind'],
  parentId: string,
  childKind: TopologyEdge['childKind'],
  childId: string,
  validFrom = '2026-08-01T00:00:00.000Z',
  validTo: string | null = null,
  tenantId = 'tenant-alpha',
): TopologyEdge {
  return {
    schema: 'ftth.topology-edge.v1',
    id: `te-${parentKind}-${parentId}-${childKind}-${childId}-${validFrom}`,
    tenantId,
    parentKind,
    parentId,
    childKind,
    childId,
    validFrom,
    validTo,
    source: 'smartolt:sync',
    createdAt: validFrom,
  };
}

describe('isEdgeValidAt — Point-in-time temporal edge validity', () => {
  const activeEdge = makeEdge('CTO', 'CTO-1', 'ONU', 'ONU-1', '2026-08-01T00:00:00.000Z', null);
  const historicalEdge = makeEdge(
    'CTO',
    'CTO-1',
    'ONU',
    'ONU-2',
    '2026-08-01T00:00:00.000Z',
    '2026-09-01T00:00:00.000Z',
  );

  it('treats active edges (validTo: null) as valid when asOf is omitted or after validFrom', () => {
    expect(isEdgeValidAt(activeEdge)).toBe(true);
    expect(isEdgeValidAt(activeEdge, '2026-08-15T00:00:00.000Z')).toBe(true);
    expect(isEdgeValidAt(activeEdge, '2026-09-15T00:00:00.000Z')).toBe(true);
  });

  it('treats active edges as invalid when asOf is before validFrom', () => {
    expect(isEdgeValidAt(activeEdge, '2026-07-15T00:00:00.000Z')).toBe(false);
  });

  it('treats historical edges as valid only within [validFrom, validTo)', () => {
    // When asOf is omitted, historical edge is inactive
    expect(isEdgeValidAt(historicalEdge)).toBe(false);

    // Before validFrom -> false
    expect(isEdgeValidAt(historicalEdge, '2026-07-31T23:59:59.999Z')).toBe(false);

    // Exactly at validFrom -> true
    expect(isEdgeValidAt(historicalEdge, '2026-08-01T00:00:00.000Z')).toBe(true);

    // During valid window -> true
    expect(isEdgeValidAt(historicalEdge, '2026-08-15T12:00:00.000Z')).toBe(true);

    // At or after validTo -> false
    expect(isEdgeValidAt(historicalEdge, '2026-09-01T00:00:00.000Z')).toBe(false);
    expect(isEdgeValidAt(historicalEdge, '2026-09-02T00:00:00.000Z')).toBe(false);
  });
});

describe('Temporal BFS Traversals (bfsAncestors, bfsDownstream, topologyPath)', () => {
  // Scenario: ONU-100 was connected to CTO-OLD until 2026-09-05, then migrated to CTO-NEW.
  const edges: TopologyEdge[] = [
    // Historical connection: ONU-100 on CTO-OLD (valid Aug 1 to Sep 5)
    makeEdge('CTO', 'CTO-OLD', 'ONU', 'ONU-100', '2026-08-01T00:00:00.000Z', '2026-09-05T00:00:00.000Z'),
    // Migrated connection: ONU-100 on CTO-NEW (valid Sep 5 onwards)
    makeEdge('CTO', 'CTO-NEW', 'ONU', 'ONU-100', '2026-09-05T00:00:00.000Z', null),
    // Common upstream infrastructure
    makeEdge('SPLITTER', 'SPL-1', 'CTO', 'CTO-OLD', '2026-08-01T00:00:00.000Z', null),
    makeEdge('SPLITTER', 'SPL-2', 'CTO', 'CTO-NEW', '2026-08-01T00:00:00.000Z', null),
  ];

  it('resolves historical ancestors asOf an incident prior to migration', () => {
    const ancestorsHistorical = bfsAncestors(edges, 'ONU', 'ONU-100', '2026-09-01T12:00:00.000Z');
    expect(ancestorsHistorical).toEqual([
      { kind: 'SPLITTER', id: 'SPL-1' },
      { kind: 'CTO', id: 'CTO-OLD' },
    ]);

    const pathHistorical = topologyPath(edges, 'ONU', 'ONU-100', '2026-09-01T12:00:00.000Z');
    expect(pathHistorical).toEqual([
      { kind: 'ONU', id: 'ONU-100' },
      { kind: 'CTO', id: 'CTO-OLD' },
      { kind: 'SPLITTER', id: 'SPL-1' },
    ]);
  });

  it('resolves current ancestors when asOf is after migration or omitted', () => {
    const ancestorsCurrent = bfsAncestors(edges, 'ONU', 'ONU-100');
    expect(ancestorsCurrent).toEqual([
      { kind: 'SPLITTER', id: 'SPL-2' },
      { kind: 'CTO', id: 'CTO-NEW' },
    ]);

    const ancestorsWithCurrentAsOf = bfsAncestors(edges, 'ONU', 'ONU-100', '2026-09-08T00:00:00.000Z');
    expect(ancestorsWithCurrentAsOf).toEqual(ancestorsCurrent);
  });

  it('returns downstream ONUs corresponding strictly to the requested point in time', () => {
    // On 2026-09-01 (before migration):
    expect(bfsDownstream(edges, 'CTO', 'CTO-OLD', '2026-09-01T00:00:00.000Z')).toEqual(['ONU-100']);
    expect(bfsDownstream(edges, 'CTO', 'CTO-NEW', '2026-09-01T00:00:00.000Z')).toEqual([]);

    // On 2026-09-08 (after migration):
    expect(bfsDownstream(edges, 'CTO', 'CTO-OLD', '2026-09-08T00:00:00.000Z')).toEqual([]);
    expect(bfsDownstream(edges, 'CTO', 'CTO-NEW', '2026-09-08T00:00:00.000Z')).toEqual(['ONU-100']);

    // Omitted asOf defaults to active:
    expect(bfsDownstream(edges, 'CTO', 'CTO-OLD')).toEqual([]);
    expect(bfsDownstream(edges, 'CTO', 'CTO-NEW')).toEqual(['ONU-100']);
  });
});

describe('correlateByTopologyAndTime — Historical topology reconstruction', () => {
  it('correlates historical events according to the topology that was active at the time of the incident', () => {
    // 3 ONUs originally on CTO-OLD:
    // On 2026-08-20, all 3 failed simultaneously.
    // On 2026-09-01, ONU-1 and ONU-2 were migrated to CTO-MIGRATED.
    const historicalEdges: TopologyEdge[] = [
      // CTO-OLD original edges (valid until 2026-09-01)
      makeEdge('CTO', 'CTO-OLD', 'ONU', 'ONU-1', '2026-08-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'),
      makeEdge('CTO', 'CTO-OLD', 'ONU', 'ONU-2', '2026-08-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'),
      makeEdge('CTO', 'CTO-OLD', 'ONU', 'ONU-3', '2026-08-01T00:00:00.000Z', null), // remained
      makeEdge('CTO', 'CTO-OLD', 'ONU', 'ONU-4', '2026-08-01T00:00:00.000Z', null), // remained healthy

      // Migrated edges active from 2026-09-01 onwards
      makeEdge('CTO', 'CTO-MIGRATED', 'ONU', 'ONU-1', '2026-09-01T00:00:00.000Z', null),
      makeEdge('CTO', 'CTO-MIGRATED', 'ONU', 'ONU-2', '2026-09-01T00:00:00.000Z', null),
    ];

    // Events occurred in the past (2026-08-20)
    const historicalEvents = [
      makeEvent('ONU-1', '2026-08-20T10:00:00.000Z'),
      makeEvent('ONU-2', '2026-08-20T10:00:30.000Z'),
      makeEvent('ONU-3', '2026-08-20T10:01:00.000Z'),
    ];

    const groups = correlateByTopologyAndTime(historicalEvents, historicalEdges, {
      ...DEFAULT_CORRELATION_CONFIG,
      minAffectedCount: 3,
      minAffectedRatio: 0.5,
    });

    // The correlation must be with CTO-OLD (their ancestor at incident time), NOT CTO-MIGRATED
    expect(groups).toHaveLength(1);
    expect(groups[0]!.ancestorKind).toBe('CTO');
    expect(groups[0]!.ancestorId).toBe('CTO-OLD');
    expect(groups[0]!.affectedCount).toBe(3);
    expect(groups[0]!.totalPopulation).toBe(4);
    expect(groups[0]!.affectedRatio).toBe(0.75);
    expect(groups[0]!.affectedDeviceIds).toEqual(['ONU-1', 'ONU-2', 'ONU-3']);
    expect(groups[0]!.healthyDeviceIds).toEqual(['ONU-4']);
  });
});
