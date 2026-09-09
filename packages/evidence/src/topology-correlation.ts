import type {
  TopologyCorrelationEvent,
  TopologyCorrelationConfig,
  TopologyCorrelationGroup,
  TopologyEdge,
  TopologyNodeKind,
} from '@ftth-copilot/shared';
import {
  TOPOLOGY_CORRELATION_SCHEMA,
  topologyCorrelationGroupSchema,
} from '@ftth-copilot/shared';
import { bfsAncestors, bfsDownstream } from './topology';

const DEFAULT_ANCESTOR_KINDS: TopologyNodeKind[] = ['CTO', 'SPLITTER', 'PON_PORT', 'OLT'];

interface CandidateAncestor {
  kind: TopologyNodeKind;
  id: string;
  specificityRank: number;
}

/**
 * Groups events within a temporal window where timestamps fall within config.timeWindowMs.
 * Returns deterministic event clusters sorted by start timestamp.
 */
function clusterEventsByTime(
  events: ReadonlyArray<TopologyCorrelationEvent>,
  timeWindowMs: number,
): TopologyCorrelationEvent[][] {
  if (events.length === 0) return [];

  // Sort events deterministically: timestamp asc, deviceId asc, sourceEventId asc
  const sorted = [...events].sort((a, b) => {
    const timeA = new Date(a.timestamp).getTime();
    const timeB = new Date(b.timestamp).getTime();
    if (timeA !== timeB) return timeA - timeB;
    if (a.deviceId !== b.deviceId) return a.deviceId.localeCompare(b.deviceId);
    return (a.sourceEventId ?? '').localeCompare(b.sourceEventId ?? '');
  });

  const clusters: TopologyCorrelationEvent[][] = [];
  let currentCluster: TopologyCorrelationEvent[] = [sorted[0]!];
  let clusterStartTime = new Date(sorted[0]!.timestamp).getTime();

  for (let i = 1; i < sorted.length; i++) {
    const ev = sorted[i]!;
    const evTime = new Date(ev.timestamp).getTime();

    // Check if event falls within the window from the current cluster's start time
    if (evTime - clusterStartTime <= timeWindowMs) {
      currentCluster.push(ev);
    } else {
      clusters.push(currentCluster);
      currentCluster = [ev];
      clusterStartTime = evTime;
    }
  }

  if (currentCluster.length > 0) {
    clusters.push(currentCluster);
  }

  return clusters;
}

/**
 * Correlates events for a single isolated tenant.
 */
function correlateTenantEvents(
  tenantId: string,
  events: ReadonlyArray<TopologyCorrelationEvent>,
  edges: ReadonlyArray<TopologyEdge>,
  config: TopologyCorrelationConfig,
): TopologyCorrelationGroup[] {
  if (events.length === 0 || edges.length === 0) return [];

  const targetKinds = config.targetAncestorKinds ?? DEFAULT_ANCESTOR_KINDS;
  const clusters = clusterEventsByTime(events, config.timeWindowMs);
  const groups: TopologyCorrelationGroup[] = [];

  for (const cluster of clusters) {
    // 1. Identify all candidate ancestors for devices in this cluster
    const candidateMap = new Map<string, CandidateAncestor>();

    for (const ev of cluster) {
      const ancestors = bfsAncestors(edges, ev.deviceKind, ev.deviceId);
      for (const anc of ancestors) {
        const rank = targetKinds.indexOf(anc.kind);
        if (rank >= 0) {
          const key = `${anc.kind}:${anc.id}`;
          if (!candidateMap.has(key)) {
            candidateMap.set(key, {
              kind: anc.kind,
              id: anc.id,
              specificityRank: rank,
            });
          }
        }
      }
    }

    // Sort candidate ancestors by specificity (lower rank index = more specific),
    // then by id alphabetically for determinism.
    const candidates = Array.from(candidateMap.values()).sort((a, b) => {
      if (a.specificityRank !== b.specificityRank) {
        return a.specificityRank - b.specificityRank;
      }
      return a.id.localeCompare(b.id);
    });

    const coveredDeviceIds = new Set<string>();

    for (const candidate of candidates) {
      // Downstream population under this ancestor
      const downstreamOnus = bfsDownstream(edges, candidate.kind, candidate.id);
      const totalPopulation = downstreamOnus.length;
      if (totalPopulation === 0) continue;

      const downstreamSet = new Set(downstreamOnus);
      const affectedInCluster = cluster.filter((e) => downstreamSet.has(e.deviceId));
      const affectedDeviceIds = Array.from(new Set(affectedInCluster.map((e) => e.deviceId))).sort();
      const affectedCount = affectedDeviceIds.length;
      const affectedRatio = Math.round((affectedCount / totalPopulation) * 10000) / 10000;

      // Threshold check: minimum affected count and minimum ratio over observed population
      if (
        affectedCount < config.minAffectedCount ||
        affectedRatio < config.minAffectedRatio
      ) {
        continue;
      }

      // Check if all affected devices are already covered by a more specific descendant
      const uncoveredAffected = affectedDeviceIds.filter((id) => !coveredDeviceIds.has(id));
      if (uncoveredAffected.length === 0) {
        // Redundant ancestor group, suppressed in favor of more specific group
        continue;
      }

      // Mark affected devices as covered
      for (const id of affectedDeviceIds) {
        coveredDeviceIds.add(id);
      }

      const affectedSet = new Set(affectedDeviceIds);
      const healthyDeviceIds = downstreamOnus.filter((id) => !affectedSet.has(id)).sort();

      // Window bounds for this specific group (based on events contributing to this ancestor)
      const sortedContributingEvents = [...affectedInCluster].sort((a, b) => {
        const timeA = new Date(a.timestamp).getTime();
        const timeB = new Date(b.timestamp).getTime();
        if (timeA !== timeB) return timeA - timeB;
        return a.deviceId.localeCompare(b.deviceId);
      });

      const windowStart = sortedContributingEvents[0]!.timestamp;
      const windowEnd = sortedContributingEvents[sortedContributingEvents.length - 1]!.timestamp;

      const evidenceEventIds = Array.from(
        new Set(
          sortedContributingEvents.map(
            (e) => e.sourceEventId ?? `ev-${e.tenantId}-${e.deviceId}-${e.timestamp}`,
          ),
        ),
      ).sort();

      const groupId = `tcg-${tenantId}-${candidate.kind.toLowerCase()}-${candidate.id}-${windowStart}`;
      const percentage = Math.round(affectedRatio * 100);

      const rawGroup: TopologyCorrelationGroup = {
        schema: TOPOLOGY_CORRELATION_SCHEMA,
        groupId,
        tenantId,
        ancestorKind: candidate.kind,
        ancestorId: candidate.id,
        windowStart,
        windowEnd,
        affectedCount,
        totalPopulation,
        affectedRatio,
        affectedDeviceIds,
        healthyDeviceIds,
        evidenceEventIds,
        ruleMatched: 'RULE_SHARED_ANCESTOR_THRESHOLD',
        hypothesisSupport: `Topology correlation identified ${affectedCount}/${totalPopulation} (${percentage}%) affected devices sharing upstream ${candidate.kind} ${candidate.id}`,
      };

      // Strict runtime contract validation
      const group = topologyCorrelationGroupSchema.parse(rawGroup);
      groups.push(group);
    }
  }

  // Sort groups deterministically: windowStart asc, ancestorKind asc, ancestorId asc
  return groups.sort((a, b) => {
    const timeA = new Date(a.windowStart).getTime();
    const timeB = new Date(b.windowStart).getTime();
    if (timeA !== timeB) return timeA - timeB;
    if (a.ancestorKind !== b.ancestorKind) return a.ancestorKind.localeCompare(b.ancestorKind);
    return a.ancestorId.localeCompare(b.ancestorId);
  });
}

/**
 * Deterministically correlates incident/failure events by shared upstream topology ancestor,
 * temporal proximity window, affected count threshold, and population ratio threshold.
 *
 * Implements strict tenant isolation and most-specific ancestor preference.
 */
export function correlateByTopologyAndTime(
  events: ReadonlyArray<TopologyCorrelationEvent>,
  edges: ReadonlyArray<TopologyEdge>,
  config: TopologyCorrelationConfig,
  targetTenantId?: string,
): TopologyCorrelationGroup[] {
  if (events.length === 0 || edges.length === 0) return [];

  if (targetTenantId) {
    const tenantEvents = events.filter((e) => e.tenantId === targetTenantId);
    const tenantEdges = edges.filter((e) => e.tenantId === targetTenantId);
    return correlateTenantEvents(targetTenantId, tenantEvents, tenantEdges, config);
  }

  // Multi-tenant processing: run correlation per tenant independently
  const tenants = Array.from(new Set(events.map((e) => e.tenantId))).sort();
  const allGroups: TopologyCorrelationGroup[] = [];

  for (const tenantId of tenants) {
    const tenantEvents = events.filter((e) => e.tenantId === tenantId);
    const tenantEdges = edges.filter((e) => e.tenantId === tenantId);
    const tenantGroups = correlateTenantEvents(tenantId, tenantEvents, tenantEdges, config);
    allGroups.push(...tenantGroups);
  }

  return allGroups.sort((a, b) => {
    if (a.tenantId !== b.tenantId) return a.tenantId.localeCompare(b.tenantId);
    const timeA = new Date(a.windowStart).getTime();
    const timeB = new Date(b.windowStart).getTime();
    if (timeA !== timeB) return timeA - timeB;
    return a.ancestorId.localeCompare(b.ancestorId);
  });
}
