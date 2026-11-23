/**
 * Property-based tests for canonical Zod contracts in `packages/shared/src/contracts.ts`.
 *
 * Reproducibility:
 *   - Every property uses an explicit fixed seed (`SEED = 20260923`) and bounded run count
 *     (`RUNS = 200`), passed directly to `fc.assert(..., { seed: SEED, numRuns: RUNS })`.
 *   - All fixtures are purely synthetic (invented tenant IDs `tenant-*`, invented device IDs).
 *
 * Invariants verified:
 *   - S-1: `schema.parse(input)` deep-equals `input` (unconditionally for `.strict()` schemas;
 *     for canonical inputs without unknown top-level keys on the 4 non-strict schemas that strip
 *     unknown top-level keys). Canonical values also survive JSON serialization and reparsing.
 *   - S-2: `schema.parse(schema.parse(input))` deep-equals `schema.parse(input)` (idempotence),
 *     including non-strict schemas receiving unknown top-level keys.
 *   - S-3: `tenantId` survives parsing unchanged and is never defaulted; empty `tenantId` is rejected.
 *   - S-4: All `.strict()` schemas reject unknown extra top-level keys.
 *   - S-5: `topologyEdgeSchema` rejects `validTo <= validFrom` and accepts `null` / omitted / `validTo > validFrom`.
 *   - S-9: Enum schemas accept exactly their declared members and reject all other strings.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { z } from 'zod';
import {
  VerdictCodeSchema,
  VerdictSeveritySchema,
  abstentionSchema,
  actionSchema,
  actionTypeSchema,
  confirmedIncidentSchema,
  evidenceProvenanceSchema,
  findingKindSchema,
  findingSchema,
  hypothesisSupportLevels,
  injectionSuspicionExportSchema,
  investigationCheckKinds,
  investigationCheckSchema,
  investigationContradictionSchema,
  investigationEvidenceKinds,
  investigationEvidenceRefSchema,
  investigationFeedbackSchema,
  investigationHypothesisSchema,
  investigationMissingSchema,
  investigationResultSchema,
  investigationRunSchema,
  investigationSufficiencyStates,
  investigationVersionSchema,
  pendingIncidentCandidateSchema,
  telemetryEventSchema,
  telemetrySourceSchema,
  tenantPolicySchema,
  topologyCorrelationConfigSchema,
  topologyCorrelationEventSchema,
  topologyCorrelationGroupSchema,
  topologyEdgeSchema,
  topologyNodeKindSchema,
  verdictCodesSchema,
  verdictLogSchema,
} from '../../src/contracts';
import {
  abstentionArb,
  actionArb,
  confirmedIncidentArb,
  epochMsArb,
  evidenceProvenanceArb,
  findingArb,
  injectionSuspicionExportArb,
  investigationCheckArb,
  investigationContradictionArb,
  investigationEvidenceRefArb,
  investigationFeedbackArb,
  investigationHypothesisArb,
  investigationMissingArb,
  investigationResultArb,
  investigationRunArb,
  investigationVersionArb,
  pendingIncidentCandidateArb,
  safeRecordKeyArb,
  telemetryEventArb,
  tenantIdArb,
  tenantPolicyArb,
  topologyCorrelationConfigArb,
  topologyCorrelationEventArb,
  topologyCorrelationGroupArb,
  topologyEdgeArb,
  verdictCodeArb,
  verdictLogArb,
} from './arbitraries';

const SEED = 20260923;
const RUNS = 200;

interface SchemaEntry<T extends Record<string, unknown>> {
  name: string;
  schema: z.ZodType<T>;
  arb: fc.Arbitrary<T>;
  strict: boolean;
  knownKeys: readonly string[];
}

const STRICT_ENVELOPES: readonly SchemaEntry<Record<string, unknown>>[] = [
  {
    name: 'abstentionSchema',
    schema: abstentionSchema,
    arb: abstentionArb,
    strict: true,
    knownKeys: Object.keys(abstentionSchema.shape),
  },
  {
    name: 'confirmedIncidentSchema',
    schema: confirmedIncidentSchema,
    arb: confirmedIncidentArb,
    strict: true,
    knownKeys: Object.keys(confirmedIncidentSchema.shape),
  },
  {
    name: 'pendingIncidentCandidateSchema',
    schema: pendingIncidentCandidateSchema,
    arb: pendingIncidentCandidateArb,
    strict: true,
    knownKeys: Object.keys(pendingIncidentCandidateSchema.shape),
  },
  {
    name: 'tenantPolicySchema',
    schema: tenantPolicySchema,
    arb: tenantPolicyArb,
    strict: true,
    knownKeys: Object.keys(tenantPolicySchema.shape),
  },
  {
    name: 'topologyEdgeSchema',
    schema: topologyEdgeSchema,
    arb: topologyEdgeArb,
    strict: true,
    knownKeys: Object.keys(topologyEdgeSchema._def.schema.shape),
  },
  {
    name: 'verdictLogSchema',
    schema: verdictLogSchema,
    arb: verdictLogArb,
    strict: true,
    knownKeys: Object.keys(verdictLogSchema.shape),
  },
  {
    name: 'injectionSuspicionExportSchema',
    schema: injectionSuspicionExportSchema,
    arb: injectionSuspicionExportArb,
    strict: true,
    knownKeys: Object.keys(injectionSuspicionExportSchema.shape),
  },
  {
    name: 'investigationRunSchema',
    schema: investigationRunSchema,
    arb: investigationRunArb,
    strict: true,
    knownKeys: Object.keys(investigationRunSchema.shape),
  },
  {
    name: 'investigationVersionSchema',
    schema: investigationVersionSchema,
    arb: investigationVersionArb,
    strict: true,
    knownKeys: Object.keys(investigationVersionSchema.shape),
  },
  {
    name: 'investigationFeedbackSchema',
    schema: investigationFeedbackSchema,
    arb: investigationFeedbackArb,
    strict: true,
    knownKeys: Object.keys(investigationFeedbackSchema.shape),
  },
  {
    name: 'investigationHypothesisSchema',
    schema: investigationHypothesisSchema,
    arb: investigationHypothesisArb,
    strict: true,
    knownKeys: Object.keys(investigationHypothesisSchema.shape),
  },
  {
    name: 'investigationContradictionSchema',
    schema: investigationContradictionSchema,
    arb: investigationContradictionArb,
    strict: true,
    knownKeys: Object.keys(investigationContradictionSchema.shape),
  },
  {
    name: 'investigationMissingSchema',
    schema: investigationMissingSchema,
    arb: investigationMissingArb,
    strict: true,
    knownKeys: Object.keys(investigationMissingSchema.shape),
  },
  {
    name: 'investigationCheckSchema',
    schema: investigationCheckSchema,
    arb: investigationCheckArb,
    strict: true,
    knownKeys: Object.keys(investigationCheckSchema.shape),
  },
  {
    name: 'investigationEvidenceRefSchema',
    schema: investigationEvidenceRefSchema,
    arb: investigationEvidenceRefArb,
    strict: true,
    knownKeys: Object.keys(investigationEvidenceRefSchema.shape),
  },
  {
    name: 'investigationResultSchema',
    schema: investigationResultSchema,
    arb: investigationResultArb,
    strict: true,
    knownKeys: Object.keys(investigationResultSchema._def.schema._def.schema.shape),
  },
  {
    name: 'topologyCorrelationEventSchema',
    schema: topologyCorrelationEventSchema,
    arb: topologyCorrelationEventArb,
    strict: true,
    knownKeys: Object.keys(topologyCorrelationEventSchema.shape),
  },
  {
    name: 'topologyCorrelationConfigSchema',
    schema: topologyCorrelationConfigSchema,
    arb: topologyCorrelationConfigArb,
    strict: true,
    knownKeys: Object.keys(topologyCorrelationConfigSchema.shape),
  },
  {
    name: 'topologyCorrelationGroupSchema',
    schema: topologyCorrelationGroupSchema,
    arb: topologyCorrelationGroupArb,
    strict: true,
    knownKeys: Object.keys(topologyCorrelationGroupSchema.shape),
  },
];

const NON_STRICT_ENVELOPES: readonly SchemaEntry<Record<string, unknown>>[] = [
  {
    name: 'evidenceProvenanceSchema',
    schema: evidenceProvenanceSchema,
    arb: evidenceProvenanceArb,
    strict: false,
    knownKeys: Object.keys(evidenceProvenanceSchema.shape),
  },
  {
    name: 'telemetryEventSchema',
    schema: telemetryEventSchema,
    arb: telemetryEventArb,
    strict: false,
    knownKeys: Object.keys(telemetryEventSchema.shape),
  },
  {
    name: 'findingSchema',
    schema: findingSchema,
    arb: findingArb,
    strict: false,
    knownKeys: Object.keys(findingSchema.shape),
  },
  {
    name: 'actionSchema',
    schema: actionSchema,
    arb: actionArb,
    strict: false,
    knownKeys: Object.keys(actionSchema.shape),
  },
];

const ALL_OBJECT_SCHEMAS = [...STRICT_ENVELOPES, ...NON_STRICT_ENVELOPES];

interface TenantSchemaEntry {
  name: string;
  schema: z.ZodTypeAny;
  arb: fc.Arbitrary<Record<string, unknown>>;
  getTenantId: (v: Record<string, unknown>) => unknown;
  withTenantId: (v: Record<string, unknown>, tenantId: string) => Record<string, unknown>;
}

const topLevelTenantEntry = <T extends { tenantId: string }>(
  name: string,
  schema: z.ZodType<T>,
  arb: fc.Arbitrary<T>,
): TenantSchemaEntry => ({
  name,
  schema,
  arb: arb as fc.Arbitrary<Record<string, unknown>>,
  getTenantId: (v) => v.tenantId,
  withTenantId: (v, tenantId) => ({ ...v, tenantId }),
});

const TENANT_CARRYING_SCHEMAS: readonly TenantSchemaEntry[] = [
  topLevelTenantEntry('evidenceProvenanceSchema', evidenceProvenanceSchema, evidenceProvenanceArb),
  topLevelTenantEntry('telemetryEventSchema', telemetryEventSchema, telemetryEventArb),
  {
    name: 'findingSchema',
    schema: findingSchema,
    arb: findingArb as fc.Arbitrary<Record<string, unknown>>,
    getTenantId: (v) => (v.context as Record<string, unknown>).tenantId,
    withTenantId: (v, tenantId) => ({
      ...v,
      context: { ...(v.context as Record<string, unknown>), tenantId },
    }),
  },
  topLevelTenantEntry('confirmedIncidentSchema', confirmedIncidentSchema, confirmedIncidentArb),
  topLevelTenantEntry(
    'pendingIncidentCandidateSchema',
    pendingIncidentCandidateSchema,
    pendingIncidentCandidateArb,
  ),
  topLevelTenantEntry('tenantPolicySchema', tenantPolicySchema, tenantPolicyArb),
  topLevelTenantEntry('topologyEdgeSchema', topologyEdgeSchema, topologyEdgeArb),
  topLevelTenantEntry('verdictLogSchema', verdictLogSchema, verdictLogArb),
  topLevelTenantEntry('investigationRunSchema', investigationRunSchema, investigationRunArb),
  topLevelTenantEntry(
    'investigationFeedbackSchema',
    investigationFeedbackSchema,
    investigationFeedbackArb,
  ),
  topLevelTenantEntry(
    'investigationResultSchema',
    investigationResultSchema,
    investigationResultArb,
  ),
  topLevelTenantEntry(
    'topologyCorrelationEventSchema',
    topologyCorrelationEventSchema,
    topologyCorrelationEventArb,
  ),
  topLevelTenantEntry(
    'topologyCorrelationGroupSchema',
    topologyCorrelationGroupSchema,
    topologyCorrelationGroupArb,
  ),
];

describe('Canonical Zod contract properties (S-1..S-5, S-9)', () => {
  describe('S-1: round-trip stability (no coercion, no transform)', () => {
    it.each(STRICT_ENVELOPES)(
      'S-1: $name parse is a round trip for every accepted strict input',
      ({ schema, arb }) => {
        fc.assert(
          fc.property(arb, (input) => {
            const parsed = schema.parse(input);
            expect(parsed).toEqual(input);
          }),
          { seed: SEED, numRuns: RUNS },
        );
      },
    );

    it.each(NON_STRICT_ENVELOPES)(
      'S-1 (canonical shape): $name parse is a round trip for canonical inputs without unknown top-level keys',
      ({ schema, arb }) => {
        fc.assert(
          fc.property(arb, (input) => {
            const parsed = schema.parse(input);
            expect(parsed).toEqual(input);
          }),
          { seed: SEED, numRuns: RUNS },
        );
      },
    );

    it('S-1: verdictCodesSchema parse is a round trip for every accepted VerdictCode[]', () => {
      fc.assert(
        fc.property(fc.array(verdictCodeArb, { maxLength: 8 }), (codes) => {
          expect(verdictCodesSchema.parse(codes)).toEqual(codes);
        }),
        { seed: SEED, numRuns: RUNS },
      );
    });

    it.each(ALL_OBJECT_SCHEMAS)(
      'S-1: $name preserves its JSON representation after serialization and reparsing',
      ({ schema, arb }) => {
        fc.assert(
          fc.property(arb, (input) => {
            const wireValue: unknown = JSON.parse(JSON.stringify(schema.parse(input)));
            const reparsed = schema.parse(wireValue);
            expect(JSON.parse(JSON.stringify(reparsed))).toStrictEqual(wireValue);
          }),
          { seed: SEED, numRuns: RUNS },
        );
      },
    );
  });

  describe('S-2: parse idempotence', () => {
    it.each(ALL_OBJECT_SCHEMAS)(
      'S-2: $name parse(parse(input)) deep-equals parse(input)',
      ({ schema, arb }) => {
        fc.assert(
          fc.property(arb, (input) => {
            const once = schema.parse(input);
            const twice = schema.parse(once);
            expect(twice).toEqual(once);
          }),
          { seed: SEED, numRuns: RUNS },
        );
      },
    );

    it.each(NON_STRICT_ENVELOPES)(
      'S-2: $name parse remains idempotent even when non-strict top-level unknown keys are stripped',
      ({ schema, arb, knownKeys }) => {
        const extraKeyArb = safeRecordKeyArb.filter((k) => !knownKeys.includes(k));
        fc.assert(
          fc.property(arb, extraKeyArb, fc.string(), (input, extraKey, extraVal) => {
            const withExtra = { ...input, [extraKey]: extraVal };
            const once = schema.parse(withExtra);
            const twice = schema.parse(once);
            expect(twice).toEqual(once);
            expect(Object.prototype.hasOwnProperty.call(once, extraKey)).toBe(false);
          }),
          { seed: SEED, numRuns: RUNS },
        );
      },
    );
  });

  describe('S-3: tenantId preservation and non-defaulting', () => {
    it.each(TENANT_CARRYING_SCHEMAS)(
      'S-3: $name preserves input tenantId unchanged across distinct tenants',
      ({ schema, arb, getTenantId, withTenantId }) => {
        fc.assert(
          fc.property(arb, tenantIdArb, (sample, customTenant) => {
            const input = withTenantId(sample, customTenant);
            const parsed = schema.parse(input) as Record<string, unknown>;
            expect(getTenantId(parsed)).toBe(customTenant);
          }),
          { seed: SEED, numRuns: RUNS },
        );
      },
    );

    it.each(TENANT_CARRYING_SCHEMAS)(
      'S-3: $name rejects empty tenantId rather than falling back to a default',
      ({ schema, arb, withTenantId }) => {
        fc.assert(
          fc.property(arb, (sample) => {
            const input = withTenantId(sample, '');
            const res = schema.safeParse(input);
            expect(res.success).toBe(false);
          }),
          { seed: SEED, numRuns: RUNS },
        );
      },
    );
  });

  describe('S-4: strict schemas reject unknown extra top-level keys', () => {
    it.each(STRICT_ENVELOPES)(
      'S-4: $name (.strict()) rejects any unknown extra top-level key',
      ({ schema, arb, knownKeys }) => {
        const extraKeyArb = safeRecordKeyArb.filter((k) => !knownKeys.includes(k));
        fc.assert(
          fc.property(
            arb,
            extraKeyArb,
            fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null)),
            (sample, extraKey, extraValue) => {
              const mutated = { ...sample, [extraKey]: extraValue };
              const res = schema.safeParse(mutated);
              expect(res.success).toBe(false);
            },
          ),
          { seed: SEED, numRuns: RUNS },
        );
      },
    );
  });

  describe('S-5: topologyEdgeSchema temporal ordering', () => {
    it('S-5: topologyEdgeSchema accepts null, omitted, or validTo > validFrom', () => {
      fc.assert(
        fc.property(topologyEdgeArb, (edge) => {
          const res = topologyEdgeSchema.safeParse(edge);
          expect(res.success).toBe(true);
        }),
        { seed: SEED, numRuns: RUNS },
      );
    });

    it('S-5: topologyEdgeSchema rejects any edge where validTo <= validFrom', () => {
      fc.assert(
        fc.property(
          topologyEdgeArb,
          epochMsArb,
          fc.integer({ min: 0, max: 31_536_000_000 }),
          (baseEdge, validFromMs, nonPositiveBackstepMs) => {
            const validFrom = new Date(validFromMs).toISOString();
            const validTo = new Date(validFromMs - nonPositiveBackstepMs).toISOString();
            const invalidEdge = { ...baseEdge, validFrom, validTo };
            const res = topologyEdgeSchema.safeParse(invalidEdge);
            expect(res.success).toBe(false);
            if (!res.success) {
              expect(res.error.issues.some((issue) => issue.path.includes('validTo'))).toBe(true);
            }
          },
        ),
        { seed: SEED, numRuns: RUNS },
      );
    });
  });

  describe('S-9: enum schemas accept exactly their declared members', () => {
    const ENUM_CASES: ReadonlyArray<{
      name: string;
      schema: z.ZodEnum<[string, ...string[]]>;
      members: readonly string[];
    }> = [
      {
        name: 'VerdictCodeSchema',
        schema: VerdictCodeSchema,
        members: ['ok', 'low_confidence', 'stale', 'incomplete'],
      },
      {
        name: 'VerdictSeveritySchema',
        schema: VerdictSeveritySchema,
        members: ['ok', 'info', 'warning', 'critical'],
      },
      {
        name: 'topologyNodeKindSchema',
        schema: topologyNodeKindSchema,
        members: ['OLT', 'PON_PORT', 'SPLITTER', 'CTO', 'ONU'],
      },
      {
        name: 'telemetrySourceSchema',
        schema: telemetrySourceSchema,
        members: ['poll', 'syslog', 'snmp-trap', 'gnmi'],
      },
      {
        name: 'findingKindSchema',
        schema: findingKindSchema,
        members: [
          'signal_drift',
          'fec_degradation',
          'optical_degradation',
          'temperature_drift',
          'intermittent_connection',
          'frequent_reboots',
          'traffic_anomaly',
          'metric_anomaly',
        ],
      },
      {
        name: 'actionTypeSchema',
        schema: actionTypeSchema,
        members: ['pre_alert', 'ticket', 'workflow', 'notify'],
      },
      {
        name: 'hypothesisSupportLevels',
        schema: z.enum(hypothesisSupportLevels),
        members: ['supported', 'contradicted', 'mixed', 'unverified'],
      },
      {
        name: 'investigationSufficiencyStates',
        schema: z.enum(investigationSufficiencyStates),
        members: ['sufficient', 'provisional', 'insufficient'],
      },
      {
        name: 'investigationCheckKinds',
        schema: z.enum(investigationCheckKinds),
        members: ['observe_only', 'topology_lookup', 'recent_events', 'metric_history'],
      },
      {
        name: 'investigationEvidenceKinds',
        schema: z.enum(investigationEvidenceKinds),
        members: ['metric', 'event', 'topology', 'incident_history', 'feedback'],
      },
    ];

    it.each(ENUM_CASES)(
      'S-9: $name accepts every declared member and rejects any non-member string',
      ({ schema, members }) => {
        const memberSet = new Set(members);
        expect(schema.options).toEqual(members);

        const nonMemberArb = fc.oneof(
          fc.string({ maxLength: 32 }).filter((s) => !memberSet.has(s)),
          fc.constantFrom(...members).map((m) => m.toUpperCase()),
          fc.constantFrom(...members).map((m) => ` ${m}`),
        ).filter((s) => !memberSet.has(s));

        fc.assert(
          fc.property(fc.constantFrom(...members), nonMemberArb, (validMember, invalidString) => {
            expect(schema.parse(validMember)).toBe(validMember);
            expect(schema.safeParse(invalidString).success).toBe(false);
          }),
          { seed: SEED, numRuns: RUNS },
        );
      },
    );
  });
});
