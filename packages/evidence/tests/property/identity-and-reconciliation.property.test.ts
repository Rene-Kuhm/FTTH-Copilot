/**
 * Property-based tests for group identity, edge identity, deduplication, and
 * cross-tenant group-to-incident reconciliation in `@ftth-copilot/evidence`.
 *
 * Reproducibility: every property uses `SEED = 20260923` and `RUNS = 200`.
 * Covered invariants: E-1, E-2, E-3, E-4.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { composeEdgeIdentityKey } from '../../src/edge-identity';
import {
  composeGroupIdentityKey,
  dedupGroups,
  groupIdentityHash,
  reconcileGroups,
} from '../../src/groups-reconciler';
import {
  BASE_TIME_MS,
  confirmedIncidentArb,
  edgeIdentityArb,
  tenantIdArb,
  topologyCorrelationGroupArb,
} from './arbitraries';

const SEED = 20260923;
const RUNS = 200;

describe('Identity & group reconciliation properties (E-1..E-4)', () => {
  it('E-1: composeGroupIdentityKey and composeEdgeIdentityKey embed tenantId and separate different tenants for the same entity', () => {
    fc.assert(
      fc.property(
        topologyCorrelationGroupArb(),
        edgeIdentityArb,
        fc.tuple(tenantIdArb, tenantIdArb).filter(([a, b]) => a !== b),
        (group, edge, [tenantA, tenantB]) => {
          const groupA = { ...group, tenantId: tenantA };
          const groupB = { ...group, tenantId: tenantB };
          const groupKeyA = composeGroupIdentityKey(groupA);
          const groupKeyB = composeGroupIdentityKey(groupB);

          expect(groupKeyA.startsWith(`${tenantA}|`)).toBe(true);
          expect(groupKeyB.startsWith(`${tenantB}|`)).toBe(true);
          expect(groupKeyA).not.toBe(groupKeyB);

          const edgeA = { ...edge, tenantId: tenantA };
          const edgeB = { ...edge, tenantId: tenantB };
          const edgeKeyA = composeEdgeIdentityKey(edgeA);
          const edgeKeyB = composeEdgeIdentityKey(edgeB);

          expect(edgeKeyA.startsWith(`${tenantA}|`)).toBe(true);
          expect(edgeKeyB.startsWith(`${tenantB}|`)).toBe(true);
          expect(edgeKeyA).not.toBe(edgeKeyB);
        },
      ),
      { seed: SEED, numRuns: RUNS },
    );
  });

  it('E-2: dedupGroups preserves all groups, keeps first occurrence canonical, points duplicates via duplicateOf, and records mergedGroupIds', () => {
    const reconciledAt = new Date(BASE_TIME_MS).toISOString();
    fc.assert(
      fc.property(
        fc.array(topologyCorrelationGroupArb(), { minLength: 0, maxLength: 25 }),
        (rawGroups) => {
          const groups = rawGroups.map((g, idx) => ({ ...g, groupId: `grp-seq-${idx}` }));
          const out = dedupGroups({ groups, reconciledAt });

          expect(out).toHaveLength(groups.length);

          const firstByHash = new Map<string, { canonicalId: string; dupIds: string[] }>();
          for (let i = 0; i < groups.length; i++) {
            const g = groups[i]!;
            const r = out[i]!;
            const hash = groupIdentityHash(g);
            const tracked = firstByHash.get(hash);

            expect(r.group).toEqual(g);
            expect(r.identityHash).toBe(hash);
            expect(r.reconciledAt).toBe(reconciledAt);

            if (tracked === undefined) {
              firstByHash.set(hash, { canonicalId: g.groupId, dupIds: [] });
              expect(r.duplicateOf).toBeNull();
              expect(r.canonicalGroupId).toBe(g.groupId);
            } else {
              tracked.dupIds.push(g.groupId);
              expect(r.duplicateOf).toBe(tracked.canonicalId);
              expect(r.canonicalGroupId).toBe(tracked.canonicalId);
              expect(r.mergedGroupIds).toEqual([]);
            }
          }

          for (let i = 0; i < groups.length; i++) {
            const r = out[i]!;
            if (r.duplicateOf === null) {
              const tracked = firstByHash.get(r.identityHash)!;
              expect(r.mergedGroupIds).toEqual(tracked.dupIds);
            }
          }
        },
      ),
      { seed: SEED, numRuns: RUNS },
    );
  });

  it('E-3: dedupGroups does not mutate input and is idempotent across repeated invocations and re-projection of output groups', () => {
    const reconciledAt = new Date(BASE_TIME_MS).toISOString();
    fc.assert(
      fc.property(
        fc.array(topologyCorrelationGroupArb(), { minLength: 0, maxLength: 20 }),
        (rawGroups) => {
          const groups = rawGroups.map((g, idx) => ({ ...g, groupId: `grp-seq-${idx}` }));
          const snapshot = structuredClone(groups);

          const first = dedupGroups({ groups, reconciledAt });
          expect(groups).toEqual(snapshot);

          const second = dedupGroups({ groups, reconciledAt });
          expect(second).toEqual(first);

          // Re-running dedupGroups on the preserved underlying groups yields identical output.
          const reapplied = dedupGroups({
            groups: first.map((r) => r.group),
            reconciledAt,
          });
          expect(reapplied).toEqual(first);
        },
      ),
      { seed: SEED, numRuns: RUNS },
    );
  });

  it('E-4: reconcileGroups never associates an incident of one tenant with a group of another tenant', () => {
    const reconciledAt = new Date(BASE_TIME_MS).toISOString();
    fc.assert(
      fc.property(
        fc.array(topologyCorrelationGroupArb(), { minLength: 0, maxLength: 20 }),
        fc.array(confirmedIncidentArb(), { minLength: 0, maxLength: 20 }),
        fc.integer({ min: 0, max: 3_600_000 }),
        (rawGroups, rawIncidents, associationWindowMs) => {
          const groups = rawGroups.map((g, idx) => ({ ...g, groupId: `grp-${idx}` }));
          const incidents = rawIncidents.map((inc, idx) => ({ ...inc, id: `inc-${idx}` }));
          const incidentTenantById = new Map(incidents.map((inc) => [inc.id, inc.tenantId]));

          const out = reconcileGroups(groups, incidents, reconciledAt, associationWindowMs);
          expect(out).toHaveLength(groups.length);

          for (const reconciled of out) {
            if (reconciled.associatedIncidentId !== null) {
              expect(incidentTenantById.get(reconciled.associatedIncidentId)).toBe(
                reconciled.group.tenantId,
              );
            }
          }

          // Cross-tenant isolation proof: when all incidents belong to other tenants,
          // no group can be associated even at identical timestamps.
          for (const targetTenant of ['tenant-a', 'tenant-b', 'tenant-c'] as const) {
            const tenantGroups = groups.filter((g) => g.tenantId === targetTenant);
            const foreignIncidents = incidents.filter((inc) => inc.tenantId !== targetTenant);
            const foreignOnlyOut = reconcileGroups(
              tenantGroups,
              foreignIncidents,
              reconciledAt,
              associationWindowMs,
            );
            for (const reconciled of foreignOnlyOut) {
              expect(reconciled.associatedIncidentId).toBeNull();
            }
          }
        },
      ),
      { seed: SEED, numRuns: RUNS },
    );
  });
});
