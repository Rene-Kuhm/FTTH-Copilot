import { describe, expect, it } from 'vitest';
import {
  bfsAncestors,
  bfsDownstream,
  topologyPath,
} from '../src/topology';
import type { TopologyEdge, TopologyNodeKind } from '@ftth-copilot/shared';

/** Helper: build a TopologyEdge fixture with sensible defaults. */
function edge(
  partial: Partial<TopologyEdge> & Pick<TopologyEdge, 'parentKind' | 'parentId' | 'childKind' | 'childId'>,
): TopologyEdge {
  return {
    schema: 'ftth.topology-edge.v1',
    id: `te-${partial.parentKind}-${partial.parentId}-${partial.childKind}-${partial.childId}`,
    tenantId: partial.tenantId ?? 't1',
    parentKind: partial.parentKind,
    parentId: partial.parentId,
    childKind: partial.childKind,
    childId: partial.childId,
    validFrom: partial.validFrom ?? '2026-09-01T00:00:00.000Z',
    validTo: partial.validTo ?? null,
    source: partial.source ?? 'manual:test',
    createdAt: partial.createdAt ?? '2026-09-01T00:00:00.000Z',
  };
}

describe('bfsDownstream — pure-TS BFS on TopologyEdge[]', () => {
  it('returns [] for an empty graph', () => {
    expect(bfsDownstream([], 'OLT', 'OLT-1')).toEqual([]);
  });

  it('returns the single childId for a one-hop edge', () => {
    const edges = [edge({ parentKind: 'OLT', parentId: 'OLT-1', childKind: 'ONU', childId: 'ONU-1' })];
    expect(bfsDownstream(edges, 'OLT', 'OLT-1')).toEqual(['ONU-1']);
  });

  it('walks transitively through OLT → PON_PORT → SPLITTER → CTO → ONU', () => {
    const edges = [
      edge({ parentKind: 'OLT', parentId: 'OLT-1', childKind: 'PON_PORT', childId: 'PON-1' }),
      edge({ parentKind: 'PON_PORT', parentId: 'PON-1', childKind: 'SPLITTER', childId: 'SPL-1' }),
      edge({ parentKind: 'SPLITTER', parentId: 'SPL-1', childKind: 'CTO', childId: 'CTO-1' }),
      edge({ parentKind: 'CTO', parentId: 'CTO-1', childKind: 'ONU', childId: 'ONU-1' }),
    ];
    expect(bfsDownstream(edges, 'OLT', 'OLT-1')).toEqual(['ONU-1']);
  });

  it('returns every reachable ONU id from a multi-branch CTO', () => {
    const edges = [
      edge({ parentKind: 'CTO', parentId: 'CTO-1', childKind: 'ONU', childId: 'ONU-1' }),
      edge({ parentKind: 'CTO', parentId: 'CTO-1', childKind: 'ONU', childId: 'ONU-2' }),
      edge({ parentKind: 'CTO', parentId: 'CTO-1', childKind: 'ONU', childId: 'ONU-3' }),
    ];
    const result = bfsDownstream(edges, 'CTO', 'CTO-1');
    expect(result.sort()).toEqual(['ONU-1', 'ONU-2', 'ONU-3']);
  });

  it('excludes edges whose validTo is set (expired subtrees are filtered out)', () => {
    const edges = [
      edge({
        parentKind: 'OLT',
        parentId: 'OLT-1',
        childKind: 'ONU',
        childId: 'ONU-1',
        validTo: '2026-09-10T00:00:00.000Z',
      }),
      edge({ parentKind: 'OLT', parentId: 'OLT-1', childKind: 'ONU', childId: 'ONU-2' }),
    ];
    expect(bfsDownstream(edges, 'OLT', 'OLT-1')).toEqual(['ONU-2']);
  });

  it('survives a cycle (A → B → A) without infinite looping', () => {
    const edges = [
      edge({ parentKind: 'OLT', parentId: 'A', childKind: 'ONU', childId: 'B' }),
      edge({ parentKind: 'ONU', parentId: 'B', childKind: 'OLT', childId: 'A' }),
    ];
    // BFS visits A's ONU child (B). When walking from B we encounter A again,
    // but the visited Set guards it; no infinite loop, no throw.
    expect(bfsDownstream(edges, 'OLT', 'A')).toEqual(['B']);
  });

  it('returns [] when the root device has no matching edges (leaf OLT)', () => {
    const edges = [edge({ parentKind: 'OLT', parentId: 'OTHER', childKind: 'ONU', childId: 'ONU-1' })];
    expect(bfsDownstream(edges, 'OLT', 'LEAF-OLT')).toEqual([]);
  });

  it('walks a deep 4-hop chain and returns the terminal ONU id', () => {
    const edges = [
      edge({ parentKind: 'OLT', parentId: 'OLT-1', childKind: 'PON_PORT', childId: 'PON-1' }),
      edge({ parentKind: 'PON_PORT', parentId: 'PON-1', childKind: 'SPLITTER', childId: 'SPL-1' }),
      edge({ parentKind: 'SPLITTER', parentId: 'SPL-1', childKind: 'CTO', childId: 'CTO-1' }),
      edge({ parentKind: 'CTO', parentId: 'CTO-1', childKind: 'ONU', childId: 'ONU-1' }),
    ];
    expect(bfsDownstream(edges, 'OLT', 'OLT-1')).toEqual(['ONU-1']);
  });

  it('handles mixed-kind root (SPLITTER as the starting node)', () => {
    const edges = [
      edge({
        parentKind: 'SPLITTER',
        parentId: 'SPL-1',
        childKind: 'CTO',
        childId: 'CTO-1',
      }),
      edge({
        parentKind: 'CTO',
        parentId: 'CTO-1',
        childKind: 'ONU',
        childId: 'ONU-1',
      }),
      edge({
        parentKind: 'CTO',
        parentId: 'CTO-1',
        childKind: 'ONU',
        childId: 'ONU-2',
      }),
    ];
    expect(bfsDownstream(edges, 'SPLITTER', 'SPL-1').sort()).toEqual(['ONU-1', 'ONU-2']);
  });
});

describe('bfsAncestors — pure-TS reverse BFS', () => {
  it('returns [] for an empty graph', () => {
    expect(bfsAncestors([], 'ONU', 'ONU-1')).toEqual([]);
  });

  it('returns the single root parent for a one-hop edge', () => {
    const edges = [
      edge({ parentKind: 'OLT', parentId: 'OLT-1', childKind: 'ONU', childId: 'ONU-1' }),
    ];
    expect(bfsAncestors(edges, 'ONU', 'ONU-1')).toEqual([
      { kind: 'OLT' as TopologyNodeKind, id: 'OLT-1' },
    ]);
  });

  it('returns the full ancestor chain (root-first, no leaf)', () => {
    const edges = [
      edge({ parentKind: 'OLT', parentId: 'OLT-1', childKind: 'PON_PORT', childId: 'PON-1' }),
      edge({ parentKind: 'PON_PORT', parentId: 'PON-1', childKind: 'SPLITTER', childId: 'SPL-1' }),
      edge({ parentKind: 'SPLITTER', parentId: 'SPL-1', childKind: 'CTO', childId: 'CTO-1' }),
      edge({ parentKind: 'CTO', parentId: 'CTO-1', childKind: 'ONU', childId: 'ONU-1' }),
    ];
    expect(bfsAncestors(edges, 'ONU', 'ONU-1')).toEqual([
      { kind: 'OLT', id: 'OLT-1' },
      { kind: 'PON_PORT', id: 'PON-1' },
      { kind: 'SPLITTER', id: 'SPL-1' },
      { kind: 'CTO', id: 'CTO-1' },
    ]);
  });

  it('survives a cycle (A → B → A) without infinite looping', () => {
    const edges = [
      edge({ parentKind: 'OLT', parentId: 'A', childKind: 'ONU', childId: 'B' }),
      edge({ parentKind: 'ONU', parentId: 'B', childKind: 'OLT', childId: 'A' }),
    ];
    // Walking from CTO B → parent is OLT A → done.
    expect(bfsAncestors(edges, 'ONU', 'B')).toEqual([{ kind: 'OLT', id: 'A' }]);
  });

  it('filters out expired edges (validTo != null) before walking', () => {
    const edges = [
      edge({
        parentKind: 'CTO',
        parentId: 'CTO-1',
        childKind: 'ONU',
        childId: 'ONU-1',
        validTo: '2026-09-10T00:00:00.000Z',
      }),
      edge({ parentKind: 'OLT', parentId: 'OLT-1', childKind: 'CTO', childId: 'CTO-1' }),
    ];
    // The CTO-1 → ONU-1 edge is expired so bfsAncestors from ONU-1 finds
    // no parent and returns [].
    expect(bfsAncestors(edges, 'ONU', 'ONU-1')).toEqual([]);
  });
});

describe('topologyPath — leaf-first ordered path', () => {
  it('returns [] for an empty graph', () => {
    expect(topologyPath([], 'ONU', 'ONU-1')).toEqual([]);
  });

  it('returns leaf-first ordering for a full chain', () => {
    const edges = [
      edge({ parentKind: 'OLT', parentId: 'OLT-1', childKind: 'PON_PORT', childId: 'PON-1' }),
      edge({ parentKind: 'PON_PORT', parentId: 'PON-1', childKind: 'SPLITTER', childId: 'SPL-1' }),
      edge({ parentKind: 'SPLITTER', parentId: 'SPL-1', childKind: 'CTO', childId: 'CTO-1' }),
      edge({ parentKind: 'CTO', parentId: 'CTO-1', childKind: 'ONU', childId: 'ONU-1' }),
    ];
    expect(topologyPath(edges, 'ONU', 'ONU-1')).toEqual([
      { kind: 'ONU', id: 'ONU-1' },
      { kind: 'CTO', id: 'CTO-1' },
      { kind: 'SPLITTER', id: 'SPL-1' },
      { kind: 'PON_PORT', id: 'PON-1' },
      { kind: 'OLT', id: 'OLT-1' },
    ]);
  });

  it('returns the leaf alone when the device is a leaf OLT', () => {
    expect(topologyPath([], 'OLT', 'LEAF-OLT')).toEqual([]);
    const edges = [edge({ parentKind: 'OTHER', parentId: 'X', childKind: 'ONU', childId: 'Y' })];
    expect(topologyPath(edges, 'OLT', 'LEAF-OLT')).toEqual([]);
  });
});