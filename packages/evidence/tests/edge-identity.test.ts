import { describe, expect, it } from 'vitest';
import {
  composeEdgeIdentityKey,
  detectEdgeCollisions,
  planBackfill,
  planMigration,
  projectEdgeIdentity,
  type EdgeIdentity,
} from '../src/edge-identity';
import type { TopologyEdge } from '@ftth-copilot/shared';

function edge(o: Partial<TopologyEdge> & { connectionId?: string | null }): TopologyEdge & { connectionId: string | null } {
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
    connectionId: o.connectionId ?? null,
  };
}

describe('composeEdgeIdentityKey — identity projection (4.3)', () => {
  it('is stable for the same identity tuple', () => {
    const a: EdgeIdentity = {
      tenantId: 't_1', connectionId: 'c_1',
      parentKind: 'OLT', parentId: 'OLT-1',
      childKind: 'PON_PORT', childId: 'PON-1',
    };
    const b: EdgeIdentity = { ...a };
    expect(composeEdgeIdentityKey(a)).toBe(composeEdgeIdentityKey(b));
  });

  it('distinguishes connections for the same parent/child pair', () => {
    const base: EdgeIdentity = {
      tenantId: 't_1', connectionId: 'c_1',
      parentKind: 'OLT', parentId: 'OLT-1',
      childKind: 'ONU', childId: 'ONU-7',
    };
    const a = composeEdgeIdentityKey(base);
    const b = composeEdgeIdentityKey({ ...base, connectionId: 'c_2' });
    expect(a).not.toBe(b);
  });

  it('uses * as the canonical "no connection" placeholder', () => {
    const base: EdgeIdentity = {
      tenantId: 't_1', connectionId: null,
      parentKind: 'OLT', parentId: 'OLT-1',
      childKind: 'PON_PORT', childId: 'PON-1',
    };
    expect(composeEdgeIdentityKey(base)).toContain('|*|');
  });

  it('projectEdgeIdentity reads connectionId from the augmented edge', () => {
    const e = edge({ connectionId: 'c_X' });
    const identity = projectEdgeIdentity(e, 'c_X');
    expect(identity.connectionId).toBe('c_X');
  });
});

describe('detectEdgeCollisions — happy path (no collisions)', () => {
  it('reports clean:true when before === after', () => {
    const edges = [
      edge({ id: 'e_1', connectionId: 'c_1', childId: 'ONU-1' }),
      edge({ id: 'e_2', connectionId: 'c_1', childId: 'ONU-2' }),
    ];
    const result = detectEdgeCollisions({ before: edges, after: edges });
    expect(result.clean).toBe(true);
    expect(result.reports).toEqual([]);
  });

  it('reports clean:true when migration preserves identity tuples', () => {
    const before = [
      edge({ id: 'e_1', connectionId: 'c_1', childId: 'ONU-1' }),
      edge({ id: 'e_2', connectionId: 'c_2', childId: 'ONU-1' }), // same ONU, two connections
    ];
    const after = [
      edge({ id: 'e_1', connectionId: 'c_1', childId: 'ONU-1' }),
      edge({ id: 'e_2', connectionId: 'c_2', childId: 'ONU-1' }),
    ];
    const result = detectEdgeCollisions({ before, after });
    expect(result.clean).toBe(true);
  });
});

describe('detectEdgeCollisions — duplicate-identity', () => {
  it('reports a duplicate identity when two legacy edges share an identity tuple', () => {
    const before = [
      edge({ id: 'e_1', connectionId: 'c_1', childId: 'ONU-1' }),
      edge({ id: 'e_2', connectionId: 'c_1', childId: 'ONU-1' }), // duplicate identity
    ];
    const result = detectEdgeCollisions({ before, after: before });
    expect(result.clean).toBe(false);
    expect(result.reports).toHaveLength(1);
    expect(result.reports[0]!.kind).toBe('duplicate-identity');
    expect(result.reports[0]!.beforeIds.sort()).toEqual(['e_1', 'e_2']);
  });

  it('reports the intended ids when the migration deduplicates', () => {
    const before = [
      edge({ id: 'e_1', connectionId: 'c_1', childId: 'ONU-1' }),
      edge({ id: 'e_2', connectionId: 'c_1', childId: 'ONU-1' }),
    ];
    const after = [edge({ id: 'e_1', connectionId: 'c_1', childId: 'ONU-1' })];
    const result = detectEdgeCollisions({ before, after });
    const r = result.reports.find((x) => x.kind === 'duplicate-identity');
    expect(r).toBeDefined();
    expect(r!.afterIds).toEqual(['e_1']);
  });
});

describe('detectEdgeCollisions — cross-connection-collapse', () => {
  it('reports when two connections collapse into one', () => {
    const before = [
      edge({ id: 'e_1', connectionId: 'c_1', childId: 'ONU-1' }),
      edge({ id: 'e_2', connectionId: 'c_2', childId: 'ONU-1' }),
    ];
    const after = [
      edge({ id: 'e_1', connectionId: 'c_1', childId: 'ONU-1' }), // c_2 dropped
    ];
    const result = detectEdgeCollisions({ before, after });
    const collapse = result.reports.find((x) => x.kind === 'cross-connection-collapse');
    expect(collapse).toBeDefined();
    expect(collapse!.beforeIds.sort()).toEqual(['e_1', 'e_2']);
    expect(collapse!.afterIds).toEqual(['e_1']);
  });
});

describe('planBackfill — backfill verificable (4.3)', () => {
  it('emits preserve ops for clean edges', () => {
    const before = [
      edge({ id: 'e_1', connectionId: 'c_1', childId: 'ONU-1' }),
      edge({ id: 'e_2', connectionId: 'c_1', childId: 'ONU-2' }),
    ];
    const after = [...before];
    const { plan } = planMigration({ before, after });
    expect(plan.ops.every((op) => op.op === 'preserve')).toBe(true);
    expect(plan.verification.identityStable).toBe(true);
  });

  it('emits split ops for duplicate-identity collisions', () => {
    const before = [
      edge({ id: 'e_1', connectionId: 'c_1', childId: 'ONU-1' }),
      edge({ id: 'e_2', connectionId: 'c_1', childId: 'ONU-1' }),
    ];
    const after = [...before];
    const { plan } = planMigration({ before, after });
    const splits = plan.ops.filter((op) => op.op === 'split');
    expect(splits).toHaveLength(2);
  });

  it('emits preserve ops for cross-connection-collapse (manual review)', () => {
    const before = [
      edge({ id: 'e_1', connectionId: 'c_1', childId: 'ONU-1' }),
      edge({ id: 'e_2', connectionId: 'c_2', childId: 'ONU-1' }),
    ];
    const after = [
      edge({ id: 'e_1', connectionId: 'c_1', childId: 'ONU-1' }),
    ];
    const { plan } = planMigration({ before, after });
    expect(plan.ops.every((op) => op.op === 'preserve')).toBe(true);
  });

  it('reports identityStable:true when every preserved identity survives in the AFTER set', () => {
    const before = [
      edge({ id: 'e_1', connectionId: 'c_1', childId: 'ONU-1' }),
    ];
    const after = [
      edge({ id: 'e_1', connectionId: 'c_1', childId: 'ONU-1' }),
    ];
    const { plan } = planMigration({ before, after });
    expect(plan.verification.identityStable).toBe(true);
  });

  it('reports identityStable:false when a preserved identity is dropped', () => {
    const before = [
      edge({ id: 'e_1', connectionId: 'c_1', childId: 'ONU-1' }),
    ];
    const after: typeof before = []; // dropped
    const { plan } = planMigration({ before, after });
    expect(plan.verification.identityStable).toBe(false);
  });

  it('preservedIdentityHashes are deterministic (sorted)', () => {
    const before = [
      edge({ id: 'e_1', connectionId: 'c_1', childId: 'ONU-1' }),
      edge({ id: 'e_2', connectionId: 'c_1', childId: 'ONU-2' }),
    ];
    const after = [...before];
    const a = planMigration({ before, after }).plan.verification.preservedIdentityHashes;
    const b = planMigration({ before, after }).plan.verification.preservedIdentityHashes;
    expect(a).toEqual(b);
  });
});

describe('planMigration — convenience wrapper', () => {
  it('returns a clean detection + plan when nothing collides', () => {
    const edges = [edge({ id: 'e_1', connectionId: 'c_1', childId: 'ONU-1' })];
    const result = planMigration({ before: edges, after: edges });
    expect(result.detection.clean).toBe(true);
    expect(result.plan.verification.identityStable).toBe(true);
  });
});

describe('planBackfill — direct API', () => {
  it('returns the same shape as planMigration.plan', () => {
    const before = [edge({ id: 'e_1', connectionId: 'c_1', childId: 'ONU-1' })];
    const after = [...before];
    const detection = detectEdgeCollisions({ before, after });
    const plan = planBackfill(detection.reports, { before, after });
    expect(plan.ops.length).toBeGreaterThan(0);
    expect(typeof plan.verification.identityStable).toBe('boolean');
  });
});
