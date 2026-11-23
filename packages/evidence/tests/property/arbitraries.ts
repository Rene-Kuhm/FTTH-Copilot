/**
 * Shared fast-check arbitraries for `@ftth-copilot/evidence` property-based tests.
 *
 * All fixtures are strictly synthetic: invented tenant ids (`tenant-a`, `tenant-b`,
 * `tenant-c`), invented device/connection ids, and documentation-range timestamps.
 */
import fc from 'fast-check';
import type {
  ConfirmedIncident,
  TopologyCorrelationConfig,
  TopologyCorrelationEvent,
  TopologyCorrelationGroup,
  TopologyEdge,
  TopologyNodeKind,
} from '@ftth-copilot/shared';
import {
  CONFIRMED_INCIDENT_SCHEMA,
  TOPOLOGY_CORRELATION_SCHEMA,
  TOPOLOGY_EDGE_SCHEMA,
} from '@ftth-copilot/shared';
import type { EdgeIdentity } from '../../src/edge-identity';
import type { QualitySample, SourcePolicy } from '../../src/evidence-quality';
import type {
  CollectEvidenceArgs,
  EventEvidenceInput,
  FeedbackEvidenceInput,
  IncidentHistoryEvidenceInput,
  MetricEvidenceInput,
  TopologyEvidenceInput,
} from '../../src/evidence-collector';

export const SYNTHETIC_TENANTS = ['tenant-a', 'tenant-b', 'tenant-c'] as const;
export const ANCESTOR_KINDS: readonly TopologyNodeKind[] = [
  'CTO',
  'SPLITTER',
  'PON_PORT',
  'OLT',
] as const;
export const ALL_NODE_KINDS: readonly TopologyNodeKind[] = [
  'OLT',
  'PON_PORT',
  'SPLITTER',
  'CTO',
  'ONU',
] as const;

/** Fixed reference clock in 2026 for deterministic temporal arbitraries. */
export const BASE_TIME_MS = Date.UTC(2026, 8, 10, 12, 0, 0, 0); // 2026-09-10T12:00:00.000Z
export const DAY_MS = 86_400_000;

export const tenantIdArb: fc.Arbitrary<string> = fc.constantFrom(...SYNTHETIC_TENANTS);

export const safeIdArb = (prefix: string): fc.Arbitrary<string> =>
  fc.integer({ min: 1, max: 9999 }).map((n) => `${prefix}-${n}`);

export const isoOffsetArb = (
  minOffsetMs: number,
  maxOffsetMs: number,
): fc.Arbitrary<string> =>
  fc
    .integer({ min: minOffsetMs, max: maxOffsetMs })
    .map((offset) => new Date(BASE_TIME_MS + offset).toISOString());

export const edgeIdentityArb: fc.Arbitrary<EdgeIdentity> = fc.record({
  tenantId: tenantIdArb,
  connectionId: fc.option(fc.constantFrom('conn-1', 'conn-2', 'conn-3'), { nil: null }),
  parentKind: fc.constantFrom(...ALL_NODE_KINDS),
  parentId: safeIdArb('parent'),
  childKind: fc.constantFrom(...ALL_NODE_KINDS),
  childId: safeIdArb('child'),
});

export const topologyCorrelationGroupArb = (
  fixedTenantId?: string,
): fc.Arbitrary<TopologyCorrelationGroup> =>
  fc
    .record({
      groupId: safeIdArb('grp'),
      tenantId: fixedTenantId ? fc.constant(fixedTenantId) : tenantIdArb,
      ancestorKind: fc.constantFrom(...ANCESTOR_KINDS),
      ancestorId: fc.constantFrom('CTO-1', 'CTO-2', 'SPL-1', 'PON-1', 'OLT-1'),
      startOffsetMs: fc.integer({ min: -3_600_000, max: 3_600_000 }),
      durationMs: fc.integer({ min: 0, max: 600_000 }),
      affectedCount: fc.integer({ min: 1, max: 4 }),
      totalPopulation: fc.integer({ min: 4, max: 8 }),
    })
    .map((raw) => {
      const windowStart = new Date(BASE_TIME_MS + raw.startOffsetMs).toISOString();
      const windowEnd = new Date(
        BASE_TIME_MS + raw.startOffsetMs + raw.durationMs,
      ).toISOString();
      const affectedDeviceIds = Array.from(
        { length: raw.affectedCount },
        (_, i) => `ONU-${i + 1}`,
      );
      const healthyCount = Math.max(0, raw.totalPopulation - raw.affectedCount);
      const healthyDeviceIds = Array.from(
        { length: healthyCount },
        (_, i) => `ONU-${raw.affectedCount + i + 1}`,
      );
      const affectedRatio = Math.min(
        1,
        Math.round((raw.affectedCount / raw.totalPopulation) * 10000) / 10000,
      );
      return {
        schema: TOPOLOGY_CORRELATION_SCHEMA,
        groupId: raw.groupId,
        tenantId: raw.tenantId,
        ancestorKind: raw.ancestorKind,
        ancestorId: raw.ancestorId,
        windowStart,
        windowEnd,
        affectedCount: raw.affectedCount,
        totalPopulation: raw.totalPopulation,
        affectedRatio,
        affectedDeviceIds,
        healthyDeviceIds,
        evidenceEventIds: affectedDeviceIds.map((id) => `ev-${raw.tenantId}-${id}`),
        ruleMatched: 'RULE_SHARED_ANCESTOR_THRESHOLD',
        hypothesisSupport: `Affected ${raw.affectedCount}/${raw.totalPopulation} under ${raw.ancestorId}`,
      };
    });

const VOCAB_TOKENS = [
  'rx',
  'bajo',
  'onu',
  'fibra',
  'corte',
  'olt',
  'potencia',
  'los',
  'flapping',
  'fec',
  'splitter',
  'conector',
] as const;

export const confirmedIncidentArb = (
  fixedTenantId?: string,
): fc.Arbitrary<ConfirmedIncident> =>
  fc
    .record({
      id: safeIdArb('inc'),
      tenantId: fixedTenantId ? fc.constant(fixedTenantId) : tenantIdArb,
      deviceKind: fc.constantFrom('OLT' as const, 'ONU' as const),
      deviceId: fc.constantFrom('ONU-1', 'ONU-2', 'ONU-3', 'ONU-4', 'OLT-1'),
      summary: fc.constantFrom(
        'RX bajo en ONU',
        'Corte de fibra troncal',
        'Degradacion FEC en puerto PON',
        'Flapping optico intermitente',
      ),
      rootCause: fc.constantFrom('Conector sucio', 'Fibra atenuada', 'Falla splitter'),
      fix: fc.constantFrom('Limpieza de conector', 'Fusion de fibra', 'Reemplazo splitter'),
      resolvedDaysAgo: fc.integer({ min: 0, max: 180 }),
      createdOffsetMs: fc.integer({ min: -3_600_000, max: 3_600_000 }),
      confirmedBy: fc.constantFrom('operator' as const, 'agent' as const, 'system' as const),
      tokens: fc.array(fc.constantFrom(...VOCAB_TOKENS), { minLength: 1, maxLength: 6 }),
    })
    .map((raw) => {
      const resolvedAt = new Date(
        BASE_TIME_MS - raw.resolvedDaysAgo * DAY_MS,
      ).toISOString();
      const createdAt = new Date(BASE_TIME_MS + raw.createdOffsetMs).toISOString();
      return {
        schema: CONFIRMED_INCIDENT_SCHEMA,
        id: raw.id,
        tenantId: raw.tenantId,
        connectionId: null,
        deviceKind: raw.deviceKind,
        deviceId: raw.deviceId,
        sourceTool: 'get_onu_detail',
        summary: raw.summary,
        symptoms: [],
        rootCause: raw.rootCause,
        fix: raw.fix,
        observedAt: resolvedAt,
        resolvedAt,
        createdAt,
        updatedAt: resolvedAt,
        confirmedBy: raw.confirmedBy,
        confirmedByUserId: null,
        searchTokens: raw.tokens.join(' '),
      };
    });

export const queryStringArb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...VOCAB_TOKENS), { minLength: 1, maxLength: 4 })
  .map((words) => words.join(' '));

/**
 * Generates a realistic FTTH topology tree for a single tenant:
 * OLT-1 -> PON-1 -> SPL-1..SPL-2 -> CTO-1..CTO-4 -> ONU-1..ONU-N
 */
export function buildTenantTopologyEdges(
  tenantId: string,
  onusPerCto = 4,
): TopologyEdge[] {
  const validFrom = new Date(BASE_TIME_MS - 30 * DAY_MS).toISOString();
  const edges: TopologyEdge[] = [];
  const pushEdge = (
    parentKind: TopologyNodeKind,
    parentId: string,
    childKind: TopologyNodeKind,
    childId: string,
  ) => {
    edges.push({
      schema: TOPOLOGY_EDGE_SCHEMA,
      id: `te-${tenantId}-${parentKind}-${parentId}-${childKind}-${childId}`,
      tenantId,
      parentKind,
      parentId,
      childKind,
      childId,
      validFrom,
      validTo: null,
      source: 'smartolt:sync',
      createdAt: validFrom,
    });
  };

  pushEdge('OLT', 'OLT-1', 'PON_PORT', 'PON-1');
  pushEdge('PON_PORT', 'PON-1', 'SPLITTER', 'SPL-1');
  pushEdge('PON_PORT', 'PON-1', 'SPLITTER', 'SPL-2');
  pushEdge('SPLITTER', 'SPL-1', 'CTO', 'CTO-1');
  pushEdge('SPLITTER', 'SPL-1', 'CTO', 'CTO-2');
  pushEdge('SPLITTER', 'SPL-2', 'CTO', 'CTO-3');
  pushEdge('SPLITTER', 'SPL-2', 'CTO', 'CTO-4');

  let onuCounter = 1;
  for (let cto = 1; cto <= 4; cto++) {
    for (let k = 0; k < onusPerCto; k++) {
      pushEdge('CTO', `CTO-${cto}`, 'ONU', `ONU-${onuCounter}`);
      onuCounter += 1;
    }
  }
  return edges;
}

export const correlationConfigArb: fc.Arbitrary<TopologyCorrelationConfig> = fc.record({
  timeWindowMs: fc.constantFrom(60_000, 300_000, 600_000),
  minAffectedCount: fc.integer({ min: 1, max: 3 }),
  minAffectedRatio: fc.constantFrom(0.25, 0.5, 0.75),
  targetAncestorKinds: fc.constant(['CTO', 'SPLITTER', 'PON_PORT', 'OLT'] as TopologyNodeKind[]),
});

export const correlationEventsArb = (
  tenants: readonly string[],
  maxOnuIndex: number,
): fc.Arbitrary<TopologyCorrelationEvent[]> => {
  const onuIds = Array.from({ length: maxOnuIndex }, (_, i) => `ONU-${i + 1}`);
  return fc
    .array(
      fc.record({
        tenantId: fc.constantFrom(...tenants),
        deviceId: fc.constantFrom(...onuIds),
        offsetMs: fc.integer({ min: -900_000, max: 900_000 }),
        hasSourceEventId: fc.boolean(),
      }),
      { minLength: 0, maxLength: 30 },
    )
    .map((items) =>
      items.map((item, idx) => {
        const timestamp = new Date(BASE_TIME_MS + item.offsetMs).toISOString();
        return {
          tenantId: item.tenantId,
          deviceId: item.deviceId,
          deviceKind: 'ONU' as const,
          timestamp,
          ...(item.hasSourceEventId
            ? { sourceEventId: `src-ev-${item.tenantId}-${idx}` }
            : {}),
          severity: 'critical' as const,
          category: 'los',
          message: 'Loss of optical signal detected on ONU',
        };
      }),
    );
};

export const collectEvidenceArgsArb: fc.Arbitrary<CollectEvidenceArgs> = fc
  .record({
    targetTenant: tenantIdArb,
    windowStartOffsetMs: fc.integer({ min: -10 * DAY_MS, max: 0 }),
    windowSpanMs: fc.integer({ min: 0, max: 14 * DAY_MS }),
    metricEntries: fc.array(
      fc.record({
        tenantId: tenantIdArb,
        deviceId: fc.constantFrom('ONU-1', 'ONU-2', 'OLT-1'),
        value: fc.integer({ min: -40, max: 10 }),
        offsetFromStartMs: fc.integer({ min: -2 * DAY_MS, max: 16 * DAY_MS }),
        source: fc.constantFrom('smartolt.poll', 'fec'),
      }),
      { minLength: 0, maxLength: 40 },
    ),
    eventEntries: fc.array(
      fc.record({
        tenantId: tenantIdArb,
        deviceId: fc.constantFrom('ONU-1', 'ONU-2', 'OLT-1'),
        category: fc.constantFrom('los', 'access', 'optical'),
        offsetFromStartMs: fc.integer({ min: -2 * DAY_MS, max: 16 * DAY_MS }),
      }),
      { minLength: 0, maxLength: 30 },
    ),
    hopEntries: fc.array(
      fc.record({
        tenantId: tenantIdArb,
        sourceKind: fc.constantFrom('OLT', 'PON_PORT', 'SPLITTER', 'CTO'),
        targetKind: fc.constantFrom('PON_PORT', 'SPLITTER', 'CTO', 'ONU'),
        depth: fc.integer({ min: 1, max: 4 }),
        offsetFromStartMs: fc.integer({ min: 0, max: 14 * DAY_MS }),
      }),
      { minLength: 0, maxLength: 15 },
    ),
    incidentEntries: fc.array(
      fc.record({
        tenantId: tenantIdArb,
        deviceId: fc.constantFrom('ONU-1', 'ONU-2'),
        resolvedOffsetMs: fc.integer({ min: -30 * DAY_MS, max: 0 }),
      }),
      { minLength: 0, maxLength: 10 },
    ),
    feedbackEntries: fc.array(
      fc.record({
        tenantId: tenantIdArb,
        label: fc.constantFrom(
          'confirmed' as const,
          'incorrect' as const,
          'insufficient_data' as const,
        ),
        submittedOffsetMs: fc.integer({ min: -30 * DAY_MS, max: 0 }),
      }),
      { minLength: 0, maxLength: 10 },
    ),
  })
  .map((raw) => {
    const startMs = BASE_TIME_MS + raw.windowStartOffsetMs;
    const endMs = startMs + raw.windowSpanMs;
    const windowStart = new Date(startMs).toISOString();
    const windowEnd = new Date(endMs).toISOString();

    const metrics: MetricEvidenceInput[] = raw.metricEntries.map((m, i) => ({
      sampleId: `${m.tenantId}-m-${i}`,
      tenantId: m.tenantId,
      deviceId: m.deviceId,
      metricKind: 'RX_POWER_DBM',
      value: m.value,
      unit: 'dBm',
      recordedAt: new Date(startMs + m.offsetFromStartMs).toISOString(),
      source: m.source,
    }));

    const events: EventEvidenceInput[] = raw.eventEntries.map((e, i) => ({
      eventId: `${e.tenantId}-e-${i}`,
      tenantId: e.tenantId,
      deviceId: e.deviceId,
      category: e.category,
      message: `Synthetic event ${e.tenantId} #${i}`,
      observedAt: new Date(startMs + e.offsetFromStartMs).toISOString(),
      source: 'syslog',
    }));

    const topologyHops: TopologyEvidenceInput[] = raw.hopEntries.map((h, i) => ({
      tenantId: h.tenantId,
      sourceKind: h.sourceKind,
      sourceId: `${h.tenantId}-src-${i}`,
      targetKind: h.targetKind,
      targetId: `${h.tenantId}-dst-${i}`,
      depth: h.depth,
      observedAt: new Date(startMs + h.offsetFromStartMs).toISOString(),
    }));

    const confirmedIncidents: IncidentHistoryEvidenceInput[] = raw.incidentEntries.map(
      (inc, i) => ({
        incidentId: `${inc.tenantId}-hist-${i}`,
        tenantId: inc.tenantId,
        deviceId: inc.deviceId,
        summary: `Historical incident for ${inc.tenantId}`,
        rootCause: 'dirty_connector',
        fix: 'Cleaned connector',
        resolvedAt: new Date(startMs + inc.resolvedOffsetMs).toISOString(),
      }),
    );

    const feedbacks: FeedbackEvidenceInput[] = raw.feedbackEntries.map((fb, i) => ({
      feedbackId: `${fb.tenantId}-fb-${i}`,
      tenantId: fb.tenantId,
      runId: `run-${i}`,
      versionId: `ver-${i}`,
      label: fb.label,
      observations: `Feedback from ${fb.tenantId}`,
      submittedAt: new Date(startMs + fb.submittedOffsetMs).toISOString(),
    }));

    return {
      tenantId: raw.targetTenant,
      deviceId: 'ONU-1',
      connectionId: 'conn-1',
      incidentId: 'inc-target',
      windowStart,
      windowEnd,
      cutoffAt: windowEnd,
      metrics,
      events,
      topologyHops,
      confirmedIncidents,
      feedbacks,
    };
  });

export const sourcePolicyArb: fc.Arbitrary<SourcePolicy> = fc
  .record({
    source: fc.constantFrom('smartolt.poll', 'fec', 'custom.poll'),
    expectedCadenceMs: fc.integer({ min: 10_000, max: 120_000 }),
    ttlMs: fc.integer({ min: 60_000, max: 600_000 }),
    maxGapMs: fc.integer({ min: 60_000, max: 300_000 }),
    minSamples: fc.integer({ min: 1, max: 5 }),
  });

export const qualitySamplesArb = (
  nowMs: number,
  minOffsetMs: number,
  maxOffsetMs: number,
): fc.Arbitrary<QualitySample[]> =>
  fc.array(
    fc.record({
      sampledAt: fc.integer({ min: nowMs + minOffsetMs, max: nowMs + maxOffsetMs }),
      value: fc.option(fc.integer({ min: -50, max: 1000 }), { nil: null }),
    }),
    { minLength: 0, maxLength: 20 },
  );
