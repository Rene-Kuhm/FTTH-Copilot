import type { TopologyEdge, TopologyCorrelationEvent, TopologyCorrelationConfig } from '@ftth-copilot/shared';

export const TENANT_A = 'tenant-alpha';
export const TENANT_B = 'tenant-beta';

function makeEdge(
  parentKind: TopologyEdge['parentKind'],
  parentId: string,
  childKind: TopologyEdge['childKind'],
  childId: string,
  tenantId = TENANT_A,
): TopologyEdge {
  return {
    schema: 'ftth.topology-edge.v1',
    id: `te-${tenantId}-${parentKind}-${parentId}-${childKind}-${childId}`,
    tenantId,
    parentKind,
    parentId,
    childKind,
    childId,
    validFrom: '2026-09-01T00:00:00.000Z',
    validTo: null,
    source: 'smartolt:sync',
    createdAt: '2026-09-01T00:00:00.000Z',
  };
}

/**
 * Standard PON Tree:
 * OLT-1
 *  └── PON-1
 *       ├── SPL-1
 *       │    ├── CTO-1 -> ONU-1, ONU-2, ONU-3, ONU-4 (4 ONUs)
 *       │    └── CTO-2 -> ONU-5, ONU-6, ONU-7, ONU-8 (4 ONUs)
 *       └── SPL-2
 *            ├── CTO-3 -> ONU-9, ONU-10, ONU-11, ONU-12 (4 ONUs)
 *            └── CTO-4 -> ONU-13, ONU-14, ONU-15, ONU-16 (4 ONUs)
 * Total: 16 ONUs under PON-1. 8 ONUs under SPL-1. 4 ONUs under each CTO.
 */
export function createStandardTopologyEdges(tenantId = TENANT_A): TopologyEdge[] {
  return [
    // OLT to PON
    makeEdge('OLT', 'OLT-1', 'PON_PORT', 'PON-1', tenantId),
    // PON to Splitters
    makeEdge('PON_PORT', 'PON-1', 'SPLITTER', 'SPL-1', tenantId),
    makeEdge('PON_PORT', 'PON-1', 'SPLITTER', 'SPL-2', tenantId),
    // SPL-1 to CTOs
    makeEdge('SPLITTER', 'SPL-1', 'CTO', 'CTO-1', tenantId),
    makeEdge('SPLITTER', 'SPL-1', 'CTO', 'CTO-2', tenantId),
    // SPL-2 to CTOs
    makeEdge('SPLITTER', 'SPL-2', 'CTO', 'CTO-3', tenantId),
    makeEdge('SPLITTER', 'SPL-2', 'CTO', 'CTO-4', tenantId),
    // CTO-1 ONUs
    makeEdge('CTO', 'CTO-1', 'ONU', 'ONU-1', tenantId),
    makeEdge('CTO', 'CTO-1', 'ONU', 'ONU-2', tenantId),
    makeEdge('CTO', 'CTO-1', 'ONU', 'ONU-3', tenantId),
    makeEdge('CTO', 'CTO-1', 'ONU', 'ONU-4', tenantId),
    // CTO-2 ONUs
    makeEdge('CTO', 'CTO-2', 'ONU', 'ONU-5', tenantId),
    makeEdge('CTO', 'CTO-2', 'ONU', 'ONU-6', tenantId),
    makeEdge('CTO', 'CTO-2', 'ONU', 'ONU-7', tenantId),
    makeEdge('CTO', 'CTO-2', 'ONU', 'ONU-8', tenantId),
    // CTO-3 ONUs
    makeEdge('CTO', 'CTO-3', 'ONU', 'ONU-9', tenantId),
    makeEdge('CTO', 'CTO-3', 'ONU', 'ONU-10', tenantId),
    makeEdge('CTO', 'CTO-3', 'ONU', 'ONU-11', tenantId),
    makeEdge('CTO', 'CTO-3', 'ONU', 'ONU-12', tenantId),
    // CTO-4 ONUs
    makeEdge('CTO', 'CTO-4', 'ONU', 'ONU-13', tenantId),
    makeEdge('CTO', 'CTO-4', 'ONU', 'ONU-14', tenantId),
    makeEdge('CTO', 'CTO-4', 'ONU', 'ONU-15', tenantId),
    makeEdge('CTO', 'CTO-4', 'ONU', 'ONU-16', tenantId),
  ];
}

export function makeEvent(
  deviceId: string,
  timestamp: string,
  tenantId = TENANT_A,
  eventId?: string,
): TopologyCorrelationEvent {
  return {
    tenantId,
    deviceId,
    deviceKind: 'ONU',
    timestamp,
    sourceEventId: eventId ?? `ev-${tenantId}-${deviceId}-${timestamp}`,
    severity: 'critical',
    category: 'los',
    message: 'Loss of optical signal detected on ONU',
  };
}

export const DEFAULT_CORRELATION_CONFIG: TopologyCorrelationConfig = {
  timeWindowMs: 5 * 60 * 1000, // 5 minutes
  minAffectedCount: 3,
  minAffectedRatio: 0.5,
  targetAncestorKinds: ['CTO', 'SPLITTER', 'PON_PORT', 'OLT'],
};
