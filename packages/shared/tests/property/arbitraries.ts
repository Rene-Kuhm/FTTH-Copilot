import fc from 'fast-check';
import {
  ABSTENTION_SCHEMA,
  ACTION_SCHEMA,
  CONFIRMED_INCIDENT_SCHEMA,
  EVIDENCE_PROVENANCE_SCHEMA,
  FINDING_SCHEMA,
  INJECTION_SUSPICION_EXPORT_SCHEMA,
  INVESTIGATION_FEEDBACK_SCHEMA,
  INVESTIGATION_FREE_TEXT_BYTES,
  INVESTIGATION_RESULT_SCHEMA,
  INVESTIGATION_RUN_SCHEMA,
  INVESTIGATION_VERSION_SCHEMA,
  MAX_INVESTIGATION_CHECKS,
  MAX_INVESTIGATION_CONTRADICTIONS,
  MAX_INVESTIGATION_EVIDENCE_REFS,
  MAX_INVESTIGATION_HYPOTHESES,
  MAX_INVESTIGATION_MISSING,
  MAX_INVESTIGATION_WINDOW_DAYS,
  PENDING_INCIDENT_CANDIDATE_SCHEMA,
  TELEMETRY_SCHEMA,
  TENANT_POLICY_SCHEMA,
  TOPOLOGY_CORRELATION_SCHEMA,
  TOPOLOGY_EDGE_SCHEMA,
  VERDICT_LOG_SCHEMA,
  actionTypeSchema,
  findingKindSchema,
  hypothesisSupportLevels,
  investigationCheckKinds,
  investigationEvidenceKinds,
  investigationSufficiencyStates,
  telemetrySourceSchema,
  topologyNodeKindSchema,
  VerdictCodeSchema,
  VerdictSeveritySchema,
  type Abstention,
  type Action,
  type ConfirmedIncident,
  type EvidenceProvenance,
  type Finding,
  type InjectionSuspicionExport,
  type InvestigationCheck,
  type InvestigationContradiction,
  type InvestigationEvidenceRef,
  type InvestigationFeedback,
  type InvestigationHypothesis,
  type InvestigationMissing,
  type InvestigationResult,
  type InvestigationRun,
  type InvestigationVersion,
  type PendingIncidentCandidate,
  type TelemetryEvent,
  type TenantPolicy,
  type TopologyCorrelationConfig,
  type TopologyCorrelationEvent,
  type TopologyCorrelationGroup,
  type TopologyEdge,
  type VerdictLog,
} from '../../src/contracts';

const utf8Encoder = new TextEncoder();

export const tenantIdArb: fc.Arbitrary<string> = fc.oneof(
  fc.constantFrom('tenant-a', 'tenant-b', 'tenant-c'),
  fc.stringMatching(/^tenant-[a-z0-9]{2,12}$/),
);

export const deviceIdArb: fc.Arbitrary<string> = fc.stringMatching(
  /^(olt|onu|pon|spl|cto)-synth-[a-z0-9]{1,10}$/,
);

export const opaqueAsciiIdArb: fc.Arbitrary<string> = fc.stringMatching(
  /^[A-Za-z0-9_-]{1,32}$/,
);

export const nonEmptySafeStringArb: fc.Arbitrary<string> = fc.stringMatching(
  /^[a-zA-Z0-9._:/-]{1,40}$/,
);

export const safeRecordKeyArb: fc.Arbitrary<string> = fc.stringMatching(
  /^[a-z][a-z0-9_]{0,20}$/,
);

export const epochMsArb: fc.Arbitrary<number> = fc.integer({
  min: Date.UTC(2024, 0, 1),
  max: Date.UTC(2027, 11, 31),
});

export const isoDatetimeArb: fc.Arbitrary<string> = epochMsArb.map((ms) =>
  new Date(ms).toISOString(),
);

export const jsonSafeUnknownArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.string({ maxLength: 32 }),
  fc.integer({ min: -10_000, max: 10_000 }),
  fc.boolean(),
  fc.constant(null),
);

export function freeTextArb(minChars = 0, maxBytes = INVESTIGATION_FREE_TEXT_BYTES): fc.Arbitrary<string> {
  const safeToken = fc.constantFrom('a', 'b', 'á', 'ñ', '中', '🚀', ' ');
  return fc
    .array(safeToken, { minLength: minChars, maxLength: Math.min(200, maxBytes) })
    .map((parts) => {
      let acc = parts.join('');
      while (utf8Encoder.encode(acc).byteLength > maxBytes && acc.length > minChars) {
        acc = acc.slice(0, -1);
      }
      if (acc.length < minChars) {
        acc = 'x'.repeat(minChars);
      }
      return acc;
    });
}

export const verdictCodeArb = fc.constantFrom(...VerdictCodeSchema.options);
export const verdictSeverityArb = fc.constantFrom(...VerdictSeveritySchema.options);
export const topologyNodeKindArb = fc.constantFrom(...topologyNodeKindSchema.options);
export const telemetrySourceArb = fc.constantFrom(...telemetrySourceSchema.options);
export const findingKindArb = fc.constantFrom(...findingKindSchema.options);
export const actionTypeArb = fc.constantFrom(...actionTypeSchema.options);
export const deviceKindArb = fc.constantFrom<'OLT' | 'ONU'>('OLT', 'ONU');
export const hypothesisSupportLevelArb = fc.constantFrom(...hypothesisSupportLevels);
export const investigationSufficiencyArb = fc.constantFrom(...investigationSufficiencyStates);
export const investigationCheckKindArb = fc.constantFrom(...investigationCheckKinds);
export const investigationEvidenceKindArb = fc.constantFrom(...investigationEvidenceKinds);

const finiteNumber = (min: number, max: number): fc.Arbitrary<number> =>
  fc.double({ min, max, noNaN: true, noDefaultInfinity: true });

export const evidenceProvenanceArb: fc.Arbitrary<EvidenceProvenance> = fc.record(
  {
    schema: fc.constant(EVIDENCE_PROVENANCE_SCHEMA),
    source: nonEmptySafeStringArb,
    tenantId: tenantIdArb,
    observedAt: isoDatetimeArb,
    ttlMs: fc.integer({ min: 0, max: 86_400_000 }),
    completeness: fc.constantFrom('complete', 'partial', 'minimal'),
    confidence: finiteNumber(0, 1),
    data: jsonSafeUnknownArb,
  },
  {
    requiredKeys: ['schema', 'source', 'tenantId', 'observedAt', 'ttlMs', 'completeness', 'data'],
  },
);

export const telemetryEventArb: fc.Arbitrary<TelemetryEvent> = fc.record(
  {
    schema: fc.constant(TELEMETRY_SCHEMA),
    tenantId: tenantIdArb,
    deviceKind: deviceKindArb,
    deviceId: deviceIdArb,
    source: telemetrySourceArb,
    ts: isoDatetimeArb,
    metrics: fc
      .tuple(
        fc.record(
          {
            rx_power_dbm: finiteNumber(-45, 5),
            tx_power_dbm: finiteNumber(-10, 10),
            temperature_celsius: finiteNumber(-20, 90),
            fec_corrected: fc.integer({ min: 0, max: 1_000_000 }),
            fec_uncorrected: fc.integer({ min: 0, max: 1_000_000 }),
            bias_current_ma: finiteNumber(0, 100),
          },
          { requiredKeys: [] },
        ),
        fc.dictionary(
          safeRecordKeyArb.filter(
            (k) =>
              ![
                'rx_power_dbm',
                'tx_power_dbm',
                'temperature_celsius',
                'fec_corrected',
                'fec_uncorrected',
                'bias_current_ma',
              ].includes(k),
          ),
          finiteNumber(-100, 100),
          { maxKeys: 3 },
        ),
      )
      .map(([known, extra]) => ({ ...known, ...extra })),
    tags: fc.dictionary(safeRecordKeyArb, nonEmptySafeStringArb, { maxKeys: 3 }),
  },
  { requiredKeys: ['schema', 'tenantId', 'deviceKind', 'deviceId', 'source', 'ts', 'metrics'] },
);

export const findingArb: fc.Arbitrary<Finding> = fc.record(
  {
    schema: fc.constant(FINDING_SCHEMA),
    kind: findingKindArb,
    severity: fc.constantFrom('warning', 'critical'),
    deviceKind: deviceKindArb,
    deviceId: deviceIdArb,
    confidence: finiteNumber(0, 1),
    etaMs: fc.integer({ min: 0, max: 604_800_000 }),
    evidence: fc.dictionary(safeRecordKeyArb, jsonSafeUnknownArb, { maxKeys: 3 }),
    context: fc
      .tuple(
        fc.record(
          {
            tenantId: tenantIdArb,
            oltId: deviceIdArb,
            customer: nonEmptySafeStringArb,
          },
          { requiredKeys: ['tenantId'] },
        ),
        fc.dictionary(
          safeRecordKeyArb.filter((k) => !['tenantId', 'oltId', 'customer'].includes(k)),
          nonEmptySafeStringArb,
          { maxKeys: 2 },
        ),
      )
      .map(([known, extra]) => ({ ...known, ...extra })),
  },
  { requiredKeys: ['schema', 'kind', 'severity', 'deviceKind', 'deviceId', 'context'] },
);

export const actionArb: fc.Arbitrary<Action> = fc.record(
  {
    schema: fc.constant(ACTION_SCHEMA),
    type: actionTypeArb,
    incidentId: opaqueAsciiIdArb,
    title: nonEmptySafeStringArb,
    body: nonEmptySafeStringArb,
    targets: fc
      .tuple(
        fc.record(
          {
            webhook: fc.boolean(),
            telegram: fc.boolean(),
            ticketing: fc.boolean(),
          },
          { requiredKeys: [] },
        ),
        fc.dictionary(
          safeRecordKeyArb.filter((k) => !['webhook', 'telegram', 'ticketing'].includes(k)),
          fc.boolean(),
          { maxKeys: 2 },
        ),
      )
      .map(([known, extra]) => ({ ...known, ...extra })),
  },
  { requiredKeys: ['schema', 'type', 'incidentId', 'title', 'body', 'targets'] },
);

export const abstentionArb: fc.Arbitrary<Abstention> = fc.record(
  {
    schema: fc.constant(ABSTENTION_SCHEMA),
    reason: verdictCodeArb,
    severity: verdictSeverityArb,
    claim: nonEmptySafeStringArb,
    missing: fc.array(nonEmptySafeStringArb, { maxLength: 4 }),
    available: fc.array(nonEmptySafeStringArb, { maxLength: 4 }),
    nextStep: nonEmptySafeStringArb,
    toolsAffected: fc.array(nonEmptySafeStringArb, { minLength: 1, maxLength: 4 }),
  },
  {
    requiredKeys: [
      'schema',
      'reason',
      'severity',
      'missing',
      'available',
      'nextStep',
      'toolsAffected',
    ],
  },
);

export const confirmedIncidentArb: fc.Arbitrary<ConfirmedIncident> = fc.record(
  {
    schema: fc.constant(CONFIRMED_INCIDENT_SCHEMA),
    id: opaqueAsciiIdArb,
    tenantId: tenantIdArb,
    connectionId: fc.oneof(opaqueAsciiIdArb, fc.constant(null)),
    deviceKind: deviceKindArb,
    deviceId: deviceIdArb,
    sourceIncidentId: opaqueAsciiIdArb,
    sourceTool: nonEmptySafeStringArb,
    summary: nonEmptySafeStringArb,
    symptoms: jsonSafeUnknownArb,
    rootCause: nonEmptySafeStringArb,
    fix: nonEmptySafeStringArb,
    observedAt: isoDatetimeArb,
    resolvedAt: isoDatetimeArb,
    createdAt: isoDatetimeArb,
    updatedAt: isoDatetimeArb,
    confirmedBy: fc.constantFrom('operator', 'agent', 'system'),
    confirmedByUserId: fc.oneof(opaqueAsciiIdArb, fc.constant(null)),
    searchTokens: fc.string({ maxLength: 64 }),
    score: finiteNumber(0, 1),
    embedding: jsonSafeUnknownArb,
  },
  {
    requiredKeys: [
      'schema',
      'id',
      'tenantId',
      'deviceKind',
      'deviceId',
      'sourceTool',
      'summary',
      'symptoms',
      'rootCause',
      'fix',
      'observedAt',
      'resolvedAt',
      'createdAt',
      'updatedAt',
      'confirmedBy',
      'searchTokens',
    ],
  },
);

export const pendingIncidentCandidateArb: fc.Arbitrary<PendingIncidentCandidate> = fc.record(
  {
    schema: fc.constant(PENDING_INCIDENT_CANDIDATE_SCHEMA),
    id: opaqueAsciiIdArb,
    tenantId: tenantIdArb,
    sourceIncidentId: opaqueAsciiIdArb,
    runSessionId: opaqueAsciiIdArb,
    summary: nonEmptySafeStringArb,
    toolCallsJson: jsonSafeUnknownArb,
    proposedConfirmedAt: isoDatetimeArb,
    status: fc.constantFrom('pending', 'promoted', 'rejected'),
    createdAt: isoDatetimeArb,
  },
  {
    requiredKeys: [
      'schema',
      'id',
      'tenantId',
      'summary',
      'toolCallsJson',
      'proposedConfirmedAt',
      'status',
    ],
  },
);

export const tenantPolicyArb: fc.Arbitrary<TenantPolicy> = fc.record(
  {
    schema: fc.constant(TENANT_POLICY_SCHEMA),
    schemaVersion: fc.constant(1 as const),
    tenantId: tenantIdArb,
    retrievalLimit: fc.integer({ min: 1, max: 50 }),
    retrievalSinceDays: fc.integer({ min: 1, max: 365 }),
    truthGateMode: fc.constantFrom('observe', 'strict'),
    abstainOnCodes: fc.array(verdictCodeArb, { maxLength: 4 }),
    promotionMinAgeMs: fc.integer({ min: 0, max: 604_800_000 }),
    learningMode: fc.constantFrom('off', 'shadow', 'active'),
    learningArtifactPins: fc.dictionary(
      fc.stringMatching(/^[a-z0-9_-]{1,24}$/),
      fc.stringMatching(/^v[0-9]{1,4}$/),
      { maxKeys: 3 },
    ),
    lastEvaluatedAt: isoDatetimeArb,
    createdAt: isoDatetimeArb,
    updatedAt: isoDatetimeArb,
  },
  { requiredKeys: ['schema', 'schemaVersion', 'tenantId', 'createdAt', 'updatedAt'] },
);

export const topologyEdgeArb: fc.Arbitrary<TopologyEdge> = fc
  .tuple(
    epochMsArb,
    fc.oneof(
      fc.constant(undefined),
      fc.constant(null),
      fc.integer({ min: 1, max: 31_536_000_000 }),
    ),
    fc.record({
      schema: fc.constant(TOPOLOGY_EDGE_SCHEMA),
      id: opaqueAsciiIdArb,
      tenantId: tenantIdArb,
      parentKind: topologyNodeKindArb,
      parentId: deviceIdArb,
      childKind: topologyNodeKindArb,
      childId: deviceIdArb,
      source: nonEmptySafeStringArb,
      createdAt: isoDatetimeArb,
    }),
  )
  .map(([validFromMs, deltaOrNull, base]) => {
    const validFrom = new Date(validFromMs).toISOString();
    if (deltaOrNull === undefined) {
      return { ...base, validFrom };
    }
    if (deltaOrNull === null) {
      return { ...base, validFrom, validTo: null };
    }
    return { ...base, validFrom, validTo: new Date(validFromMs + deltaOrNull).toISOString() };
  });

export const verdictLogArb: fc.Arbitrary<VerdictLog> = fc.record(
  {
    schema: fc.constant(VERDICT_LOG_SCHEMA),
    id: opaqueAsciiIdArb,
    tenantId: tenantIdArb,
    messageId: opaqueAsciiIdArb,
    conversationId: opaqueAsciiIdArb,
    toolName: nonEmptySafeStringArb,
    code: verdictCodeArb,
    severity: verdictSeverityArb,
    observedAt: isoDatetimeArb,
    injectionSuspicion: fc.boolean(),
  },
  { requiredKeys: ['schema', 'id', 'tenantId', 'toolName', 'code', 'severity', 'observedAt'] },
);

export const injectionSuspicionExportArb: fc.Arbitrary<InjectionSuspicionExport> = fc.record({
  schema: fc.constant(INJECTION_SUSPICION_EXPORT_SCHEMA),
  generatedAt: isoDatetimeArb,
  total: fc.integer({ min: 0, max: 100_000 }),
  byTenant: fc.dictionary(tenantIdArb, fc.integer({ min: 0, max: 10_000 }), { maxKeys: 4 }),
  byCode: fc.dictionary(verdictCodeArb, fc.integer({ min: 0, max: 10_000 }), { maxKeys: 4 }),
});

export const investigationRunArb: fc.Arbitrary<InvestigationRun> = fc.record({
  schema: fc.constant(INVESTIGATION_RUN_SCHEMA),
  runId: opaqueAsciiIdArb,
  tenantId: tenantIdArb,
  connectionId: fc.oneof(opaqueAsciiIdArb, fc.constant(null)),
  incidentId: fc.oneof(opaqueAsciiIdArb, fc.constant(null)),
  requestedBy: nonEmptySafeStringArb,
  requestedAt: isoDatetimeArb,
});

export const investigationVersionArb: fc.Arbitrary<InvestigationVersion> = fc.record({
  schema: fc.constant(INVESTIGATION_VERSION_SCHEMA),
  versionId: opaqueAsciiIdArb,
  runId: opaqueAsciiIdArb,
  versionIndex: fc.integer({ min: 0, max: 1000 }),
  rulesetVersion: nonEmptySafeStringArb,
  promptVersion: nonEmptySafeStringArb,
  modelVersion: nonEmptySafeStringArb,
  snapshotAt: isoDatetimeArb,
});

export const investigationFeedbackArb: fc.Arbitrary<InvestigationFeedback> = fc.record({
  schema: fc.constant(INVESTIGATION_FEEDBACK_SCHEMA),
  feedbackId: opaqueAsciiIdArb,
  versionId: opaqueAsciiIdArb,
  runId: opaqueAsciiIdArb,
  tenantId: tenantIdArb,
  authorUserId: nonEmptySafeStringArb,
  submittedAt: isoDatetimeArb,
  label: nonEmptySafeStringArb,
});

export const investigationEvidenceRefArb: fc.Arbitrary<InvestigationEvidenceRef> = fc.record({
  evidenceRefId: opaqueAsciiIdArb,
  kind: investigationEvidenceKindArb,
  source: nonEmptySafeStringArb,
  observedAt: isoDatetimeArb,
  summary: freeTextArb(1, 256),
  quality: fc.constantFrom('fresh', 'stale', 'insufficient', 'unknown', 'error'),
  qualityReason: nonEmptySafeStringArb,
});

export const investigationHypothesisArb: fc.Arbitrary<InvestigationHypothesis> = fc.record({
  hypothesisId: opaqueAsciiIdArb,
  summary: freeTextArb(1, 256),
  supportLevel: hypothesisSupportLevelArb,
  forRefIds: fc.array(opaqueAsciiIdArb, { maxLength: 4 }),
  againstRefIds: fc.array(opaqueAsciiIdArb, { maxLength: 4 }),
});

export const investigationContradictionArb: fc.Arbitrary<InvestigationContradiction> = fc.record({
  evidenceRefId: opaqueAsciiIdArb,
  note: freeTextArb(0, 256),
});

export const investigationMissingArb: fc.Arbitrary<InvestigationMissing> = fc.record(
  {
    what: freeTextArb(1, 256),
    whyItMatters: freeTextArb(0, 256),
  },
  { requiredKeys: ['what'] },
);

export const investigationCheckArb: fc.Arbitrary<InvestigationCheck> = fc.record(
  {
    checkId: opaqueAsciiIdArb,
    kind: investigationCheckKindArb,
    description: freeTextArb(1, 256),
    expectedToResolve: freeTextArb(0, 256),
  },
  { requiredKeys: ['checkId', 'kind', 'description'] },
);

export const producedByArb: fc.Arbitrary<string> = fc.oneof(
  fc.stringMatching(/^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$/).map((v) => `agent-core@${v}`),
  fc.stringMatching(/^[a-z0-9_-]{1,16}$/).map((u) => `human:${u}`),
);

export const investigationResultArb: fc.Arbitrary<InvestigationResult> = fc
  .tuple(
    epochMsArb,
    fc.integer({ min: 0, max: 30 * 86_400_000 }),
    epochMsArb,
    fc.integer({ min: 0, max: 86_400_000 }),
    fc.record({
      schema: fc.constant(INVESTIGATION_RESULT_SCHEMA),
      resultId: opaqueAsciiIdArb,
      runId: opaqueAsciiIdArb,
      versionId: opaqueAsciiIdArb,
      tenantId: tenantIdArb,
      connectionId: fc.oneof(opaqueAsciiIdArb, fc.constant(null)),
      incidentId: fc.oneof(opaqueAsciiIdArb, fc.constant(null)),
      windowDays: finiteNumber(0.01, MAX_INVESTIGATION_WINDOW_DAYS),
      rulesetVersion: nonEmptySafeStringArb,
      modelVersion: nonEmptySafeStringArb,
      promptVersion: nonEmptySafeStringArb,
      evidenceRefs: fc.array(investigationEvidenceRefArb, {
        maxLength: Math.min(3, MAX_INVESTIGATION_EVIDENCE_REFS),
      }),
      hypotheses: fc.array(investigationHypothesisArb, {
        maxLength: Math.min(3, MAX_INVESTIGATION_HYPOTHESES),
      }),
      contradictions: fc.array(investigationContradictionArb, {
        maxLength: Math.min(3, MAX_INVESTIGATION_CONTRADICTIONS),
      }),
      missing: fc.array(investigationMissingArb, {
        maxLength: Math.min(3, MAX_INVESTIGATION_MISSING),
      }),
      suggestedChecks: fc.array(investigationCheckArb, {
        maxLength: Math.min(3, MAX_INVESTIGATION_CHECKS),
      }),
      sufficiency: investigationSufficiencyArb,
      sufficiencyReason: freeTextArb(1, 256),
      producedBy: producedByArb,
    }),
  )
  .map(([windowStartMs, windowSpanMs, cutoffMs, prodDelayMs, base]) => ({
    ...base,
    windowStart: new Date(windowStartMs).toISOString(),
    windowEnd: new Date(windowStartMs + windowSpanMs).toISOString(),
    cutoffAt: new Date(cutoffMs).toISOString(),
    producedAt: new Date(cutoffMs + prodDelayMs).toISOString(),
  }));

export const topologyCorrelationEventArb: fc.Arbitrary<TopologyCorrelationEvent> = fc.record(
  {
    tenantId: tenantIdArb,
    deviceId: deviceIdArb,
    deviceKind: topologyNodeKindArb,
    timestamp: isoDatetimeArb,
    sourceEventId: opaqueAsciiIdArb,
    severity: fc.constantFrom('warning', 'critical'),
    category: nonEmptySafeStringArb,
    message: nonEmptySafeStringArb,
  },
  { requiredKeys: ['tenantId', 'deviceId', 'deviceKind', 'timestamp'] },
);

export const topologyCorrelationConfigArb: fc.Arbitrary<TopologyCorrelationConfig> = fc.record(
  {
    timeWindowMs: fc.integer({ min: 1, max: 3_600_000 }),
    minAffectedCount: fc.integer({ min: 1, max: 100 }),
    minAffectedRatio: finiteNumber(0, 1),
    targetAncestorKinds: fc.array(topologyNodeKindArb, { maxLength: 3 }),
  },
  { requiredKeys: ['timeWindowMs', 'minAffectedCount', 'minAffectedRatio'] },
);

export const topologyCorrelationGroupArb: fc.Arbitrary<TopologyCorrelationGroup> = fc.record({
  schema: fc.constant(TOPOLOGY_CORRELATION_SCHEMA),
  groupId: opaqueAsciiIdArb,
  tenantId: tenantIdArb,
  ancestorKind: topologyNodeKindArb,
  ancestorId: deviceIdArb,
  windowStart: isoDatetimeArb,
  windowEnd: isoDatetimeArb,
  affectedCount: fc.integer({ min: 0, max: 500 }),
  totalPopulation: fc.integer({ min: 1, max: 500 }),
  affectedRatio: finiteNumber(0, 1),
  affectedDeviceIds: fc.array(deviceIdArb, { maxLength: 4 }),
  healthyDeviceIds: fc.array(deviceIdArb, { maxLength: 4 }),
  evidenceEventIds: fc.array(opaqueAsciiIdArb, { maxLength: 4 }),
  ruleMatched: nonEmptySafeStringArb,
  hypothesisSupport: nonEmptySafeStringArb,
});
