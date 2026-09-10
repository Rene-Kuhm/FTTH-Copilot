import { describe, expect, it } from 'vitest';
import {
  associateGroupsWithIncidents,
  composeGroupIdentityKey,
  dedupGroups,
  groupIdentityHash,
  reconcileGroups,
  type ReconciledGroup,
} from '../src/groups-reconciler';
import type {
  ConfirmedIncident,
  TopologyCorrelationGroup,
} from '@ftth-copilot/shared';

const NOW = '2026-09-10T12:00:00.000Z';

function makeGroup(o: Partial<TopologyCorrelationGroup>): TopologyCorrelationGroup {
  return {
    schema: 'ftth.topology-correlation.v1' as const,
    groupId: o.groupId ?? 'g_' + Math.random().toString(36).slice(2, 8),
    tenantId: o.tenantId ?? 't_1',
    ancestorKind: o.ancestorKind ?? 'CTO',
    ancestorId: o.ancestorId ?? 'CTO-1',
    windowStart: o.windowStart ?? '2026-09-10T10:00:00.000Z',
    windowEnd: o.windowEnd ?? '2026-09-10T10:15:00.000Z',
    affectedCount: o.affectedCount ?? 3,
    totalPopulation: o.totalPopulation ?? 4,
    affectedRatio: o.affectedRatio ?? 0.75,
    affectedDeviceIds: o.affectedDeviceIds ?? ['ONU-1', 'ONU-2', 'ONU-3'],
    healthyDeviceIds: o.healthyDeviceIds ?? ['ONU-4'],
    evidenceEventIds: o.evidenceEventIds ?? ['e_1', 'e_2', 'e_3'],
    ruleMatched: o.ruleMatched ?? 'shared-ancestor:CTO-1',
    hypothesisSupport: o.hypothesisSupport ?? 'supported',
  };
}

function makeIncident(o: Partial<ConfirmedIncident>): ConfirmedIncident {
  return {
    schema: 'ftth.confirmed-incident.v1' as const,
    id: o.id ?? 'inc_' + Math.random().toString(36).slice(2, 8),
    tenantId: o.tenantId ?? 't_1',
    connectionId: null,
    deviceKind: 'ONU',
    deviceId: 'ONU-1',
    sourceTool: 'human',
    summary: 'CTO outage',
    symptoms: {},
    rootCause: 'Fiber cut',
    fix: 'Splice',
    observedAt: o.observedAt ?? '2026-09-10T10:05:00.000Z',
    resolvedAt: '2026-09-10T10:30:00.000Z',
    createdAt: o.createdAt ?? '2026-09-10T10:10:00.000Z',
    updatedAt: '2026-09-10T10:30:00.000Z',
    confirmedBy: 'operator',
    confirmedByUserId: null,
    searchTokens: '',
  };
}

describe('composeGroupIdentityKey / groupIdentityHash', () => {
  it('is stable for the same inputs', () => {
    const g = makeGroup({});
    expect(groupIdentityHash(g)).toBe(groupIdentityHash(g));
  });

  it('is the same as composeGroupIdentityKey for the same shape', () => {
    const g = makeGroup({});
    expect(groupIdentityHash(g)).toBe(
      composeGroupIdentityKey({
        tenantId: g.tenantId,
        ancestorKind: g.ancestorKind,
        ancestorId: g.ancestorId,
        windowStart: g.windowStart,
        windowEnd: g.windowEnd,
      }),
    );
  });

  it('distinguishes different windows', () => {
    const a = makeGroup({ windowStart: '2026-09-10T10:00:00.000Z', windowEnd: '2026-09-10T10:15:00.000Z' });
    const b = makeGroup({ windowStart: '2026-09-10T10:00:00.000Z', windowEnd: '2026-09-10T10:16:00.000Z' });
    expect(groupIdentityHash(a)).not.toBe(groupIdentityHash(b));
  });
});

describe('dedupGroups — reproducible dedup (4.4)', () => {
  it('passes through a single group unchanged', () => {
    const g = makeGroup({ groupId: 'g_1' });
    const out = dedupGroups({ groups: [g], reconciledAt: NOW });
    expect(out).toHaveLength(1);
    expect(out[0]!.duplicateOf).toBeNull();
    expect(out[0]!.canonicalGroupId).toBe('g_1');
    expect(out[0]!.mergedGroupIds).toEqual([]);
  });

  it('marks a duplicate with duplicateOf pointing at the canonical', () => {
    const a = makeGroup({ groupId: 'g_1' });
    const b = makeGroup({ groupId: 'g_2' });
    const out = dedupGroups({ groups: [a, b], reconciledAt: NOW });
    expect(out).toHaveLength(2);
    expect(out[0]!.canonicalGroupId).toBe('g_1');
    expect(out[0]!.duplicateOf).toBeNull();
    expect(out[1]!.canonicalGroupId).toBe('g_1');
    expect(out[1]!.duplicateOf).toBe('g_1');
  });

  it('does NOT destroy duplicates — the canonical carries mergedGroupIds', () => {
    const a = makeGroup({ groupId: 'g_1' });
    const b = makeGroup({ groupId: 'g_2' });
    const c = makeGroup({ groupId: 'g_3' });
    const out = dedupGroups({ groups: [a, b, c], reconciledAt: NOW });
    const canonical = out.find((g) => g.canonicalGroupId === 'g_1' && g.duplicateOf === null);
    expect(canonical).toBeDefined();
    expect(canonical!.mergedGroupIds).toEqual(['g_2', 'g_3']);
    expect(out).toHaveLength(3); // nothing deleted
  });

  it('is idempotent — running twice produces the same output', () => {
    const a = makeGroup({ groupId: 'g_1' });
    const b = makeGroup({ groupId: 'g_2' });
    const r1 = dedupGroups({ groups: [a, b], reconciledAt: NOW });
    const r2 = dedupGroups({ groups: [a, b], reconciledAt: NOW });
    expect(r1).toEqual(r2);
  });

  it('keeps different tenants as separate canonicals', () => {
    const a = makeGroup({ groupId: 'g_1', tenantId: 't_A' });
    const b = makeGroup({ groupId: 'g_2', tenantId: 't_B' });
    const out = dedupGroups({ groups: [a, b], reconciledAt: NOW });
    expect(out.every((g) => g.duplicateOf === null)).toBe(true);
  });
});

describe('associateGroupsWithIncidents — by temporal proximity (4.4)', () => {
  it('associates a group with the nearest incident within the window', () => {
    const g: ReconciledGroup = {
      group: makeGroup({ groupId: 'g_1', windowStart: '2026-09-10T10:00:00.000Z' }),
      identityHash: 'h_1',
      canonicalGroupId: 'g_1',
      mergedGroupIds: [],
      duplicateOf: null,
      associatedIncidentId: null,
      reconciledAt: NOW,
    };
    const inc = makeIncident({ id: 'inc_X', createdAt: '2026-09-10T10:05:00.000Z' });
    const out = associateGroupsWithIncidents({ groups: [g], incidents: [inc] });
    expect(out[0]!.associatedIncidentId).toBe('inc_X');
  });

  it('does NOT associate when the incident is outside the window', () => {
    const g: ReconciledGroup = {
      group: makeGroup({ groupId: 'g_1', windowStart: '2026-09-10T10:00:00.000Z' }),
      identityHash: 'h_1',
      canonicalGroupId: 'g_1',
      mergedGroupIds: [],
      duplicateOf: null,
      associatedIncidentId: null,
      reconciledAt: NOW,
    };
    const inc = makeIncident({ id: 'inc_X', createdAt: '2026-09-10T11:00:00.000Z' });
    const out = associateGroupsWithIncidents({ groups: [g], incidents: [inc] });
    expect(out[0]!.associatedIncidentId).toBeNull();
  });

  it('does NOT cross tenants — t_A group never sees a t_B incident', () => {
    const g: ReconciledGroup = {
      group: makeGroup({ groupId: 'g_1', tenantId: 't_A', windowStart: '2026-09-10T10:00:00.000Z' }),
      identityHash: 'h_1',
      canonicalGroupId: 'g_1',
      mergedGroupIds: [],
      duplicateOf: null,
      associatedIncidentId: null,
      reconciledAt: NOW,
    };
    const inc = makeIncident({ id: 'inc_X', tenantId: 't_B', createdAt: '2026-09-10T10:00:00.000Z' });
    const out = associateGroupsWithIncidents({ groups: [g], incidents: [inc] });
    expect(out[0]!.associatedIncidentId).toBeNull();
  });

  it('associates with the nearest incident when several are within the window', () => {
    const g: ReconciledGroup = {
      group: makeGroup({ groupId: 'g_1', windowStart: '2026-09-10T10:00:00.000Z' }),
      identityHash: 'h_1',
      canonicalGroupId: 'g_1',
      mergedGroupIds: [],
      duplicateOf: null,
      associatedIncidentId: null,
      reconciledAt: NOW,
    };
    const incFar = makeIncident({ id: 'inc_far', createdAt: '2026-09-10T10:14:00.000Z' });
    const incNear = makeIncident({ id: 'inc_near', createdAt: '2026-09-10T10:01:00.000Z' });
    const out = associateGroupsWithIncidents({ groups: [g], incidents: [incFar, incNear] });
    expect(out[0]!.associatedIncidentId).toBe('inc_near');
  });

  it('is pure — does not mutate the input', () => {
    const g: ReconciledGroup = {
      group: makeGroup({ groupId: 'g_1' }),
      identityHash: 'h_1',
      canonicalGroupId: 'g_1',
      mergedGroupIds: [],
      duplicateOf: null,
      associatedIncidentId: null,
      reconciledAt: NOW,
    };
    const inc = makeIncident({ id: 'inc_X' });
    associateGroupsWithIncidents({ groups: [g], incidents: [inc] });
    expect(g.associatedIncidentId).toBeNull();
  });
});

describe('reconcileGroups — convenience pipeline', () => {
  it('runs dedup then association in one call', () => {
    const a = makeGroup({ groupId: 'g_1', windowStart: '2026-09-10T10:00:00.000Z' });
    const b = makeGroup({ groupId: 'g_2', windowStart: '2026-09-10T10:00:00.000Z' });
    const inc = makeIncident({ id: 'inc_X', createdAt: '2026-09-10T10:05:00.000Z' });
    const out = reconcileGroups([a, b], [inc], NOW);
    expect(out).toHaveLength(2);
    const canonical = out.find((g) => g.duplicateOf === null);
    expect(canonical!.associatedIncidentId).toBe('inc_X');
    const duplicate = out.find((g) => g.duplicateOf !== null);
    expect(duplicate!.associatedIncidentId).toBe('inc_X'); // also associated
  });
});
