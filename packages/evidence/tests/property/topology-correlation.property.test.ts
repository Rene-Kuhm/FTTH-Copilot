/**
 * Property-based tests for deterministic topology and time correlation in
 * `@ftth-copilot/evidence`.
 *
 * Reproducibility: every property uses `SEED = 20260923` and `RUNS = 200`.
 * Covered invariants: E-5, E-6, E-12.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  topologyCorrelationGroupSchema,
  type TopologyCorrelationEvent,
  type TopologyCorrelationGroup,
} from '@ftth-copilot/shared';
import { correlateByTopologyAndTime } from '../../src/topology-correlation';
import {
  BASE_TIME_MS,
  SYNTHETIC_TENANTS,
  buildTenantTopologyEdges,
  correlationConfigArb,
  correlationEventsArb,
  tenantIdArb,
} from './arbitraries';

const SEED = 20260923;
const RUNS = 200;

const CTO_COUNT = 4;
const ONUS_PER_CTO = 4;
const TOTAL_ONUS = ONUS_PER_CTO * CTO_COUNT;

const MIXED_EDGES = SYNTHETIC_TENANTS.flatMap((t) =>
  buildTenantTopologyEdges(t, ONUS_PER_CTO),
);

function expectedEventRefId(ev: TopologyCorrelationEvent): string {
  return ev.sourceEventId ?? `ev-${ev.tenantId}-${ev.deviceId}-${ev.timestamp}`;
}

function sortGroupsCanonically(
  groups: ReadonlyArray<TopologyCorrelationGroup>,
): TopologyCorrelationGroup[] {
  return [...groups].sort((a, b) => {
    if (a.tenantId !== b.tenantId) return a.tenantId.localeCompare(b.tenantId);
    const timeDiff = new Date(a.windowStart).getTime() - new Date(b.windowStart).getTime();
    if (timeDiff !== 0) return timeDiff;
    if (a.ancestorKind !== b.ancestorKind) return a.ancestorKind.localeCompare(b.ancestorKind);
    return a.ancestorId.localeCompare(b.ancestorId);
  });
}

describe('Topology & time correlation properties', () => {
  it('E-5: correlateByTopologyAndTime isolates target tenant, references only input events of that tenant, and validates against topologyCorrelationGroupSchema', () => {
    fc.assert(
      fc.property(
        tenantIdArb,
        correlationEventsArb(SYNTHETIC_TENANTS, TOTAL_ONUS),
        correlationConfigArb,
        (targetTenant, mixedEvents, config) => {
          const targetEvents = mixedEvents.filter((e) => e.tenantId === targetTenant);
          const targetEdges = MIXED_EDGES.filter((e) => e.tenantId === targetTenant);

          const groupsFromMixed = correlateByTopologyAndTime(
            mixedEvents,
            MIXED_EDGES,
            config,
            targetTenant,
          );
          const groupsFromIsolated = correlateByTopologyAndTime(
            targetEvents,
            targetEdges,
            config,
            targetTenant,
          );

          // Foreign-tenant events and edges must have zero effect on the target tenant.
          expect(groupsFromMixed).toEqual(groupsFromIsolated);

          const allowedEventIds = new Set(targetEvents.map(expectedEventRefId));

          for (const group of groupsFromMixed) {
            expect(group.tenantId).toBe(targetTenant);
            expect(topologyCorrelationGroupSchema.safeParse(group).success).toBe(true);
            expect(group.affectedCount).toBeGreaterThanOrEqual(config.minAffectedCount);
            expect(group.affectedRatio).toBeGreaterThanOrEqual(config.minAffectedRatio);
            expect(group.affectedCount).toBe(group.affectedDeviceIds.length);
            expect(group.affectedCount + group.healthyDeviceIds.length).toBe(
              group.totalPopulation,
            );
            expect(group.evidenceEventIds.length).toBeGreaterThan(0);

            for (const evId of group.evidenceEventIds) {
              expect(allowedEventIds.has(evId)).toBe(true);
            }
          }
        },
      ),
      { seed: SEED, numRuns: RUNS },
    );
  });

  it('E-6: correlateByTopologyAndTime is order-independent under arbitrary permutations of input events', () => {
    fc.assert(
      fc.property(
        correlationEventsArb(SYNTHETIC_TENANTS, TOTAL_ONUS).chain((events) =>
          fc
            .array(fc.integer({ min: 0, max: 1_000_000 }), {
              minLength: events.length,
              maxLength: events.length,
            })
            .map((keys) => ({
              events,
              permuted: events
                .map((ev, idx) => ({ ev, key: keys[idx]! }))
                .sort((a, b) => a.key - b.key)
                .map((entry) => entry.ev),
            })),
        ),
        correlationConfigArb,
        fc.option(tenantIdArb, { nil: undefined }),
        ({ events, permuted }, config, targetTenant) => {
          const originalGroups = correlateByTopologyAndTime(
            events,
            MIXED_EDGES,
            config,
            targetTenant,
          );
          const permutedGroups = correlateByTopologyAndTime(
            permuted,
            MIXED_EDGES,
            config,
            targetTenant,
          );

          expect(sortGroupsCanonically(permutedGroups)).toEqual(
            sortGroupsCanonically(originalGroups),
          );
          expect(permutedGroups).toEqual(originalGroups);
        },
      ),
      { seed: SEED, numRuns: RUNS },
    );
  });

  it('E-12: events at the window boundary form a group per tenant even when topology IDs coincide', () => {
    const tenants = SYNTHETIC_TENANTS.slice(0, 2);
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 600_000 }),
        fc.integer({ min: -3_600_000, max: 3_600_000 }),
        fc.integer({ min: 1, max: CTO_COUNT }),
        (timeWindowMs, offsetMs, ctoNumber) => {
          const config = { timeWindowMs, minAffectedCount: 2, minAffectedRatio: 0.5 };
          const startMs = BASE_TIME_MS + offsetMs;
          const windowStart = new Date(startMs).toISOString();
          const windowEnd = new Date(startMs + timeWindowMs).toISOString();
          const firstOnu = (ctoNumber - 1) * ONUS_PER_CTO + 1;
          const affectedDeviceIds = [`ONU-${firstOnu}`, `ONU-${firstOnu + 1}`].sort();
          const events: TopologyCorrelationEvent[] = tenants.flatMap((tenantId) =>
            affectedDeviceIds.map((deviceId, index) => ({
              tenantId,
              deviceId,
              deviceKind: 'ONU',
              timestamp: index === 0 ? windowStart : windowEnd,
              sourceEventId: `${tenantId}-${deviceId}`,
            })),
          );

          const groups = correlateByTopologyAndTime(events, MIXED_EDGES, config);
          expect(groups).toHaveLength(tenants.length);
          expect(new Set(groups.map(({ groupId }) => groupId)).size).toBe(tenants.length);
          for (const tenantId of tenants) {
            expect(groups.filter((group) => group.tenantId === tenantId)).toEqual([
              expect.objectContaining({
                ancestorKind: 'CTO',
                ancestorId: `CTO-${ctoNumber}`,
                windowStart,
                windowEnd,
                affectedDeviceIds,
                evidenceEventIds: affectedDeviceIds.map((deviceId) => `${tenantId}-${deviceId}`),
              }),
            ]);
          }

          const beyondWindow = new Date(startMs + timeWindowMs + 1).toISOString();
          const separatedEvents = events.map((event) =>
            event.timestamp === windowEnd ? { ...event, timestamp: beyondWindow } : event,
          );
          expect(correlateByTopologyAndTime(separatedEvents, MIXED_EDGES, config)).toEqual([]);
        },
      ),
      { seed: SEED, numRuns: RUNS },
    );
  });
});
