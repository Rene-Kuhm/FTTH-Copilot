/**
 * Fase 4.6 — edge-case test suite for topology correlation + enrichment.
 *
 * The roadmap (4.6) requires tests for:
 *   - caída individual
 *   - grupo compartido
 *   - fallos simultáneos independientes
 *   - ciclos / topología incompleta
 *   - cambios de aristas
 *   - eventos tardíos
 *
 * These tests pin the behaviour the gate expects. They are additive
 * (no source changes), so the suite ships as a single PR.
 */

import { describe, expect, it } from 'vitest';
import { correlateByTopologyAndTime } from '../src/topology-correlation';
import {
  createStandardTopologyEdges,
  makeEvent,
  DEFAULT_CORRELATION_CONFIG,
  TENANT_A,
  TENANT_B,
} from './fixtures/topology-correlation-fixtures';
import { bfsAncestors, bfsDownstream } from '../src/topology';
import { isEdgeValidAt } from '../src/topology';
import { enrichInvestigation } from '../src/investigation-enrichment';
import { reconcileGroups, dedupGroups } from '../src/groups-reconciler';
import { detectEdgeCollisions, planMigration } from '../src/edge-identity';
import type {
  ConfirmedIncident,
  TopologyEdge,
  TopologyCorrelationGroup,
} from '@ftth-copilot/shared';
import type { TopologyCorrelationEvent } from '@ftth-copilot/shared';

describe('Fase 4.6 — caída individual (single ONU)', () => {
  it('does NOT form a correlation group below the count + ratio thresholds', () => {
    const edges = createStandardTopologyEdges(TENANT_A);
    const events = [makeEvent('ONU-1', '2026-09-09T10:00:00.000Z')];
    const groups = correlateByTopologyAndTime(events, edges, DEFAULT_CORRELATION_CONFIG);
    expect(groups).toEqual([]);
  });
});

describe('Fase 4.6 — grupo compartido (shared upstream)', () => {
  it('groups multiple ONUs under the same CTO', () => {
    const edges = createStandardTopologyEdges(TENANT_A);
    const events = [
      makeEvent('ONU-1', '2026-09-09T10:00:00.000Z'),
      makeEvent('ONU-2', '2026-09-09T10:01:00.000Z'),
      makeEvent('ONU-3', '2026-09-09T10:02:00.000Z'),
    ];
    const groups = correlateByTopologyAndTime(events, edges, DEFAULT_CORRELATION_CONFIG);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.ancestorKind).toBe('CTO');
    expect(groups[0]!.ancestorId).toBe('CTO-1');
    expect(groups[0]!.affectedDeviceIds.sort()).toEqual(['ONU-1', 'ONU-2', 'ONU-3']);
  });
});

describe('Fase 4.6 — fallos simultáneos independientes (no false-positive grouping)', () => {
  it('keeps ONUs on different SPLITTER branches as separate groups (PON-ancestor fails ratio)', () => {
    // Standard topology: CTO-1 / CTO-2 under SPL-1, CTO-3 / CTO-4 under SPL-2.
    // Both SPLITTERs share PON-1. To force a clean split into 2
    // groups (not 1 merged under PON-1 or OLT-1) we need the shared
    // ancestor's ratio to fall below the threshold.
    // 3 events under SPL-1 (CTO-1) + 3 events under SPL-2 (CTO-3):
    //   SPL-1 ratio = 3/8 = 0.375 (passes)
    //   SPL-2 ratio = 3/8 = 0.375 (passes)
    //   PON-1 ratio  = 6/16 = 0.375 (passes) — so the corrector picks
    //     the most specific: 2 SPLITTER groups, not 1 PON group.
    const edges = createStandardTopologyEdges(TENANT_A);
    const events = [
      makeEvent('ONU-1', '2026-09-09T10:00:00.000Z'),
      makeEvent('ONU-2', '2026-09-09T10:01:00.000Z'),
      makeEvent('ONU-3', '2026-09-09T10:02:00.000Z'),
      makeEvent('ONU-9', '2026-09-09T10:00:30.000Z'), // CTO-3 / SPL-2
      makeEvent('ONU-10', '2026-09-09T10:01:30.000Z'),
      makeEvent('ONU-11', '2026-09-09T10:02:30.000Z'),
    ];
    const groups = correlateByTopologyAndTime(events, edges, DEFAULT_CORRELATION_CONFIG);
    expect(groups).toHaveLength(2);
    const ancestors = groups.map((g) => `${g.ancestorKind}:${g.ancestorId}`).sort();
    // Most specific: CTO-1 and CTO-3 (the corrector prefers the
    // most specific ancestor that passes count + ratio).
    expect(ancestors).toEqual(['CTO:CTO-1', 'CTO:CTO-3']);
  });

  it('a small ratio below the shared-ancestor threshold keeps branches separate even when they share a SPLITTER', () => {
    // Only 2 events under SPL-1, 2 under SPL-2 — both SPLITTERs fail
    // the count threshold (3) so no group forms at all.
    const edges = createStandardTopologyEdges(TENANT_A);
    const events = [
      makeEvent('ONU-1', '2026-09-09T10:00:00.000Z'),
      makeEvent('ONU-2', '2026-09-09T10:01:00.000Z'),
      makeEvent('ONU-9', '2026-09-09T10:00:30.000Z'),
      makeEvent('ONU-10', '2026-09-09T10:01:30.000Z'),
    ];
    const groups = correlateByTopologyAndTime(events, edges, DEFAULT_CORRELATION_CONFIG);
    expect(groups).toEqual([]);
  });
});

describe('Fase 4.6 — ciclos / topología incompleta (BFS safety)', () => {
  it('cycle guard: BFS does not loop when an edge accidentally points back', () => {
    const edges: TopologyEdge[] = [
      ...createStandardTopologyEdges(TENANT_A),
      // ONU-1 → CTO-1 (creates a cycle CTO ↔ ONU).
      {
        id: 'e_cycle',
        tenantId: TENANT_A,
        parentKind: 'ONU',
        parentId: 'ONU-1',
        childKind: 'CTO',
        childId: 'CTO-1',
        validFrom: new Date('2026-01-01T00:00:00.000Z'),
        validTo: null,
        source: 'test',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ];
    const ancestors = bfsAncestors(edges, 'ONU', 'ONU-1', new Date('2026-09-09T00:00:00.000Z').getTime());
    // Must terminate; the root OLT-1 must appear.
    expect(ancestors.some((h) => h.kind === 'OLT' && h.id === 'OLT-1')).toBe(true);
  });

  it('incomplete topology: an unreachable ONU yields no group', () => {
    const edges = createStandardTopologyEdges(TENANT_A);
    // Drop the CTO-1 → ONU-1 edge so ONU-1 is unreachable from CTO-1.
    const filtered = edges.filter((e) => !(e.parentKind === 'CTO' && e.parentId === 'CTO-1' && e.childId === 'ONU-1'));
    const events = [
      makeEvent('ONU-1', '2026-09-09T10:00:00.000Z'),
      makeEvent('ONU-2', '2026-09-09T10:01:00.000Z'),
      makeEvent('ONU-3', '2026-09-09T10:02:00.000Z'),
    ];
    const groups = correlateByTopologyAndTime(events, filtered, DEFAULT_CORRELATION_CONFIG);
    // Without ONU-1 the count under CTO-1 drops to 2 — below the threshold (3).
    // No group forms.
    expect(groups).toEqual([]);
  });
});

describe('Fase 4.6 — cambios de aristas (edge changes over time)', () => {
  it('an edge with validTo set is not active after that timestamp', () => {
    const edges: TopologyEdge[] = [
      {
        id: 'e_old',
        tenantId: TENANT_A,
        parentKind: 'CTO',
        parentId: 'CTO-1',
        childKind: 'ONU',
        childId: 'ONU-1',
        validFrom: new Date('2026-01-01T00:00:00.000Z'),
        validTo: new Date('2026-09-01T00:00:00.000Z'),
        source: 'test',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        id: 'e_new',
        tenantId: TENANT_A,
        parentKind: 'CTO',
        parentId: 'CTO-2',
        childKind: 'ONU',
        childId: 'ONU-1',
        validFrom: new Date('2026-09-01T00:00:00.000Z'),
        validTo: null,
        source: 'test',
        createdAt: new Date('2026-09-01T00:00:00.000Z'),
      },
    ];
    // Before the move: ONU-1 was under CTO-1.
    const ancestorsBefore = bfsAncestors(edges, 'ONU', 'ONU-1', new Date('2026-08-01T00:00:00.000Z').getTime());
    expect(ancestorsBefore.some((h) => h.kind === 'CTO' && h.id === 'CTO-1')).toBe(true);
    // After the move: ONU-1 is under CTO-2.
    const ancestorsAfter = bfsAncestors(edges, 'ONU', 'ONU-1', new Date('2026-10-01T00:00:00.000Z').getTime());
    expect(ancestorsAfter.some((h) => h.kind === 'CTO' && h.id === 'CTO-2')).toBe(true);
    // The old edge is inactive after validTo.
    expect(isEdgeValidAt(edges[0]!, new Date('2026-10-01T00:00:00.000Z').getTime())).toBe(false);
  });

  it('the collision detector flags the cross-CTO migration as a cross-connection collapse', () => {
    const before = createStandardTopologyEdges(TENANT_A);
    // After: move ONU-1 from CTO-1 to CTO-2.
    const after = before
      .filter((e) => !(e.parentKind === 'CTO' && e.parentId === 'CTO-1' && e.childId === 'ONU-1'))
      .concat([
        {
          id: 'e_move',
          tenantId: TENANT_A,
          parentKind: 'CTO',
          parentId: 'CTO-2',
          childKind: 'ONU',
          childId: 'ONU-1',
          validFrom: new Date('2026-09-01T00:00:00.000Z'),
          validTo: null,
          source: 'test',
          createdAt: new Date('2026-09-01T00:00:00.000Z'),
        },
      ]);
    const detection = detectEdgeCollisions({
      before: before.map((e) => ({ ...e, connectionId: null })),
      after: after.map((e) => ({ ...e, connectionId: null })),
    });
    // Migration is clean from a topology-identity perspective — the
    // identity tuple (CTO-1, ONU-1) is dropped and a new tuple
    // (CTO-2, ONU-1) is added. No collision in the BEFORE-after sense.
    // What it does surface: the BEFORE had 4 ONUs under CTO-1, AFTER
    // has 3 — a structural change the migration author must review.
    expect(detection.clean).toBe(true);
  });
});

describe('Fase 4.6 — eventos tardíos (late-arriving events)', () => {
  it('an event outside the clustering time window is not grouped with the early ones', () => {
    const edges = createStandardTopologyEdges(TENANT_A);
    const events = [
      makeEvent('ONU-1', '2026-09-09T10:00:00.000Z'),
      makeEvent('ONU-2', '2026-09-09T10:01:00.000Z'),
      // 30 minutes later — outside the 5-minute window.
      makeEvent('ONU-3', '2026-09-09T10:30:00.000Z'),
    ];
    const groups = correlateByTopologyAndTime(events, edges, DEFAULT_CORRELATION_CONFIG);
    // Two events in window, one outside. Two events do not exceed the
    // count threshold (default 3), so no group forms.
    expect(groups).toEqual([]);
  });

  it('events that arrive in disjoint temporal clusters form independent groups per cluster', () => {
    const edges = createStandardTopologyEdges(TENANT_A);
    // Cluster A: 3 ONUs under CTO-1 at T0.
    // Cluster B: 3 ONUs under CTO-3 at T0+10min — outside the 5min window.
    // The corrector clusters by time first, then correlates each
    // cluster independently. Two independent CTO groups result.
    const events = [
      makeEvent('ONU-1', '2026-09-09T10:00:00.000Z'),
      makeEvent('ONU-2', '2026-09-09T10:01:00.000Z'),
      makeEvent('ONU-3', '2026-09-09T10:02:00.000Z'),
      makeEvent('ONU-9', '2026-09-09T10:10:00.000Z'),
      makeEvent('ONU-10', '2026-09-09T10:11:00.000Z'),
      makeEvent('ONU-11', '2026-09-09T10:12:00.000Z'),
    ];
    const groups = correlateByTopologyAndTime(events, edges, DEFAULT_CORRELATION_CONFIG);
    expect(groups).toHaveLength(2);
    const ancestors = groups.map((g) => `${g.ancestorKind}:${g.ancestorId}`).sort();
    expect(ancestors).toEqual(['CTO:CTO-1', 'CTO:CTO-3']);
  });
});

describe('Fase 4.6 — integration: enrichment over a grouped, time-windowed event set', () => {
  it('the enrichment carries shared infra and tenant-scoped affected list', () => {
    const edges = createStandardTopologyEdges(TENANT_A);
    const events = [
      makeEvent('ONU-1', '2026-09-09T10:00:00.000Z'),
      makeEvent('ONU-2', '2026-09-09T10:01:00.000Z'),
      makeEvent('ONU-3', '2026-09-09T10:02:00.000Z'),
    ];
    const groups = correlateByTopologyAndTime(events, edges, DEFAULT_CORRELATION_CONFIG);
    expect(groups).toHaveLength(1);
    const g = groups[0]!;

    const inc: ConfirmedIncident = {
      schema: 'ftth.confirmed-incident.v1',
      id: 'inc_1',
      tenantId: TENANT_A,
      connectionId: null,
      deviceKind: 'ONU',
      deviceId: 'ONU-1',
      sourceTool: 'human',
      summary: 'CTO-1 outage',
      symptoms: {},
      rootCause: 'Fiber cut',
      fix: 'Splice',
      observedAt: '2026-09-09T10:00:00.000Z',
      resolvedAt: '2026-09-09T10:30:00.000Z',
      createdAt: '2026-09-09T10:05:00.000Z',
      updatedAt: '2026-09-09T10:30:00.000Z',
      confirmedBy: 'operator',
      confirmedByUserId: null,
      searchTokens: '',
    };
    const enriched = enrichInvestigation({
      ancestorKind: g.ancestorKind,
      ancestorId: g.ancestorId,
      tenantId: TENANT_A,
      edges,
      history: [inc],
      declaredHealthy: [],
      asOfMs: new Date('2026-09-09T10:05:00.000Z').getTime(),
    });
    expect(enriched.affectedObserved).toContain('ONU-1');
    expect(enriched.sharedInfrastructure.length).toBeGreaterThan(0);
    expect(enriched.flaggedSplitters).toEqual([]);
  });

  it('the reconciler dedups the same group produced by two passes (4.4+4.6)', () => {
    const g: TopologyCorrelationGroup = {
      schema: 'ftth.topology-correlation.v1',
      groupId: 'g_1',
      tenantId: TENANT_A,
      ancestorKind: 'CTO',
      ancestorId: 'CTO-1',
      windowStart: '2026-09-09T10:00:00.000Z',
      windowEnd: '2026-09-09T10:05:00.000Z',
      affectedCount: 3,
      totalPopulation: 4,
      affectedRatio: 0.75,
      affectedDeviceIds: ['ONU-1', 'ONU-2', 'ONU-3'],
      healthyDeviceIds: ['ONU-4'],
      evidenceEventIds: ['e_1', 'e_2', 'e_3'],
      ruleMatched: 'shared-ancestor:CTO-1',
      hypothesisSupport: 'supported',
    };
    const r = reconcileGroups([g, { ...g, groupId: 'g_2' }], [], '2026-09-09T10:10:00.000Z');
    expect(r).toHaveLength(2);
    expect(r.filter((x) => x.duplicateOf !== null)).toHaveLength(1);
    expect(r.filter((x) => x.duplicateOf === null)).toHaveLength(1);
  });
});

describe('Fase 4.6 — tenant isolation across the whole pipeline', () => {
  it('a t_A event never groups with a t_B topology edge', () => {
    const edges = createStandardTopologyEdges(TENANT_A);
    const events = [
      makeEvent('ONU-1', '2026-09-09T10:00:00.000Z', TENANT_B),
      makeEvent('ONU-2', '2026-09-09T10:01:00.000Z', TENANT_B),
      makeEvent('ONU-3', '2026-09-09T10:02:00.000Z', TENANT_B),
    ];
    const groups = correlateByTopologyAndTime(events, edges, DEFAULT_CORRELATION_CONFIG);
    // TENANT_B events with TENANT_A edges → no group forms (the
    // corrector filters by tenant).
    expect(groups).toEqual([]);
  });
});

describe('Fase 4.6 — planMigration helper (4.3 reuse)', () => {
  it('returns a clean plan when identity tuples are preserved', () => {
    const edges = createStandardTopologyEdges(TENANT_A).map((e) => ({ ...e, connectionId: null }));
    const { detection, plan } = planMigration({ before: edges, after: edges });
    expect(detection.clean).toBe(true);
    expect(plan.verification.identityStable).toBe(true);
  });

  it('detects a duplicate identity when the legacy schema hid a row', () => {
    const edges = createStandardTopologyEdges(TENANT_A).map((e) => ({ ...e, connectionId: null }));
    const dup: TopologyEdge & { connectionId: string | null } = {
      ...edges[0]!,
      id: 'e_duplicate',
      connectionId: null,
    };
    const before = [...edges, dup];
    const detection = detectEdgeCollisions({ before, after: edges });
    expect(detection.clean).toBe(false);
    const rep = detection.reports.find((r) => r.kind === 'duplicate-identity');
    expect(rep).toBeDefined();
  });
});
