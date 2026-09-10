import { describe, expect, it } from 'vitest';
import { enrichInvestigation, type EnrichInvestigationArgs } from '../src/investigation-enrichment';
import type { ConfirmedIncident, TopologyEdge, TopologyNodeKind } from '@ftth-copilot/shared';

const NOW = Date.parse('2026-09-10T12:00:00.000Z');

function edge(o: Partial<TopologyEdge> & { parentKind?: TopologyNodeKind; childKind?: TopologyNodeKind }): TopologyEdge {
  return {
    id: o.id ?? 'e_' + Math.random().toString(36).slice(2, 8),
    tenantId: o.tenantId ?? 't_1',
    parentKind: o.parentKind ?? 'OLT',
    parentId: o.parentId ?? 'OLT-1',
    childKind: o.childKind ?? 'PON_PORT',
    childId: o.childId ?? 'PON-1',
    validFrom: o.validFrom ?? new Date('2026-09-01T00:00:00.000Z'),
    validTo: o.validTo ?? null,
    source: o.source ?? 'test',
    createdAt: o.createdAt ?? new Date('2026-09-01T00:00:00.000Z'),
  };
}

function incident(o: Partial<ConfirmedIncident> & { deviceKind?: 'OLT' | 'ONU'; deviceId?: string }): ConfirmedIncident {
  return {
    schema: 'ftth.confirmed-incident.v1' as const,
    id: o.id ?? 'inc_' + Math.random().toString(36).slice(2, 8),
    tenantId: o.tenantId ?? 't_1',
    connectionId: null,
    deviceKind: o.deviceKind ?? 'ONU',
    deviceId: o.deviceId ?? 'ONU-1',
    sourceTool: 'human',
    summary: 'test',
    symptoms: {},
    rootCause: 'test',
    fix: 'test',
    observedAt: o.observedAt ?? '2026-09-10T10:00:00.000Z',
    resolvedAt: o.resolvedAt ?? '2026-09-10T10:30:00.000Z',
    createdAt: o.createdAt ?? '2026-09-10T10:00:00.000Z',
    updatedAt: o.updatedAt ?? '2026-09-10T10:30:00.000Z',
    confirmedBy: 'operator',
    confirmedByUserId: null,
    searchTokens: '',
  };
}

const BASE_EDGES: TopologyEdge[] = [
  edge({ id: 'e_1', parentKind: 'OLT', parentId: 'OLT-1', childKind: 'PON_PORT', childId: 'PON-1' }),
  edge({ id: 'e_2', parentKind: 'PON_PORT', parentId: 'PON-1', childKind: 'CTO', childId: 'CTO-1' }),
  edge({ id: 'e_3', parentKind: 'CTO', parentId: 'CTO-1', childKind: 'ONU', childId: 'ONU-1' }),
  edge({ id: 'e_4', parentKind: 'CTO', parentId: 'CTO-1', childKind: 'ONU', childId: 'ONU-2' }),
];

describe('enrichInvestigation — Fase 4.5', () => {
  it('surfaces shared infrastructure from the topology (BFS ancestors)', () => {
    const out = enrichInvestigation({
      ancestorKind: 'CTO',
      ancestorId: 'CTO-1',
      tenantId: 't_1',
      edges: BASE_EDGES,
      history: [],
      declaredHealthy: [],
      asOfMs: NOW,
    });
    // CTO-1 → PON-1 → OLT-1 (root-first: BFS returns root first)
    expect(out.sharedInfrastructure.map((s) => `${s.kind}:${s.id}`)).toEqual(['OLT:OLT-1', 'PON_PORT:PON-1']);
    expect(out.sharedInfrastructure.every((s) => s.source === 'topology')).toBe(true);
  });

  it('returns an empty affectedObserved when history is empty', () => {
    const out = enrichInvestigation({
      ancestorKind: 'CTO',
      ancestorId: 'CTO-1',
      tenantId: 't_1',
      edges: BASE_EDGES,
      history: [],
      declaredHealthy: [],
      asOfMs: NOW,
    });
    expect(out.affectedObserved).toEqual([]);
  });

  it('only counts history devices that are topology-reachable from the ancestor', () => {
    // ONU-1 is under CTO-1; ONU-99 is not.
    const out = enrichInvestigation({
      ancestorKind: 'CTO',
      ancestorId: 'CTO-1',
      tenantId: 't_1',
      edges: BASE_EDGES,
      history: [
        incident({ id: 'inc_1', deviceKind: 'ONU', deviceId: 'ONU-1' }),
        incident({ id: 'inc_2', deviceKind: 'ONU', deviceId: 'ONU-99' }),
      ],
      declaredHealthy: [],
      asOfMs: NOW,
    });
    expect(out.affectedObserved).toEqual(['ONU-1']);
  });

  it('NEVER crosses tenants — t_A history is invisible to a t_B enrichment', () => {
    const out = enrichInvestigation({
      ancestorKind: 'CTO',
      ancestorId: 'CTO-1',
      tenantId: 't_A',
      edges: BASE_EDGES,
      history: [
        incident({ id: 'inc_1', tenantId: 't_B', deviceKind: 'ONU', deviceId: 'ONU-1' }),
      ],
      declaredHealthy: [],
      asOfMs: NOW,
    });
    expect(out.affectedObserved).toEqual([]);
  });

  it('knownHealthy comes from the operator, not from inference', () => {
    const out = enrichInvestigation({
      ancestorKind: 'CTO',
      ancestorId: 'CTO-1',
      tenantId: 't_1',
      edges: BASE_EDGES,
      history: [],
      declaredHealthy: [
        { kind: 'ONU', id: 'ONU-1' },
        { kind: 'ONU', id: 'ONU-2' },
        // ONU-99 is declared healthy but not in the topology → excluded
        { kind: 'ONU', id: 'ONU-99' },
      ],
      asOfMs: NOW,
    });
    expect(out.knownHealthy).toEqual(['ONU:ONU-1', 'ONU:ONU-2']);
  });

  it('flaggedSplitters is always empty — splitters are NEVER inferred', () => {
    const out = enrichInvestigation({
      ancestorKind: 'CTO',
      ancestorId: 'CTO-1',
      tenantId: 't_1',
      edges: BASE_EDGES,
      history: [],
      declaredHealthy: [],
      asOfMs: NOW,
    });
    expect(out.flaggedSplitters).toEqual([]);
  });

  it('is pure — same inputs produce the same output', () => {
    const args: EnrichInvestigationArgs = {
      ancestorKind: 'CTO',
      ancestorId: 'CTO-1',
      tenantId: 't_1',
      edges: BASE_EDGES,
      history: [],
      declaredHealthy: [],
      asOfMs: NOW,
    };
    const a = enrichInvestigation(args);
    const b = enrichInvestigation(args);
    expect(a).toEqual(b);
  });

  it('asOf reflects the synthetic clock', () => {
    const out = enrichInvestigation({
      ancestorKind: 'CTO',
      ancestorId: 'CTO-1',
      tenantId: 't_1',
      edges: BASE_EDGES,
      history: [],
      declaredHealthy: [],
      asOfMs: NOW,
    });
    expect(out.asOf).toBe(new Date(NOW).toISOString());
  });
});
