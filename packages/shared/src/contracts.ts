/**
 * Cross-service contracts for the AIOps pipeline (see docs/aiops-roadmap.md).
 *
 * These are the stable JSON boundaries between the three stages:
 *   ingesta (telemetry.v1) → filtrado (finding.v1) → cognitiva (action.v1).
 *
 * They are language-agnostic by design: a Go collector or a Rust correlator can
 * emit/consume the exact same JSON and validate it against these zod schemas.
 * The version literal is part of the schema, so a producer can never silently
 * emit a shape the consumer does not understand.
 */
import { z } from 'zod';

// ── Version markers ──────────────────────────────────────────────────────────

export const TELEMETRY_SCHEMA = 'ftth.telemetry.v1' as const;
export const FINDING_SCHEMA = 'ftth.finding.v1' as const;
export const ACTION_SCHEMA = 'ftth.action.v1' as const;
export const EVIDENCE_PROVENANCE_SCHEMA = 'evidence.provenance.v1' as const;
export const ABSTENTION_SCHEMA = 'ftth.abstention.v1' as const;
// Fase D — confirmed-incident memory (sparse-first hybrid RAG).
export const CONFIRMED_INCIDENT_SCHEMA = 'ftth.confirmed-incident.v1' as const;
export const PENDING_INCIDENT_CANDIDATE_SCHEMA =
  'ftth.pending-incident-candidate.v1' as const;
// Fase E — per-tenant override envelope (1:1 with Tenant). Absent row →
// byte-identical to Fase C/D; per-tenant wins over env over module default.
export const TENANT_POLICY_SCHEMA = 'ftth.tenant-policy.v1' as const;
// Fase E — temporal topology (single-edge model). 5 node kinds; the BFS
// helpers + Prisma reads filter `validTo: null` to derive the live graph.
export const TOPOLOGY_EDGE_SCHEMA = 'ftth.topology-edge.v1' as const;
// Fase F — verdict-log persistence surface for `AgentResult.verdicts`. One
// row per (message, tool-call verdict) emitted by the chat route after a
// non-empty verdicts run. Wire-side mirror of the `verdict_log` Prisma
// table; consumers (F-3 finalize + F-5 chat-route writer + nightly
// metrics) read/write through this schema so the v1 storage shape never
// drifts from the column shape.
export const VERDICT_LOG_SCHEMA = 'ftth.verdict-log.v1' as const;

/**
 * VerdictCode — mirrored from the `VerdictCode` union in
 * `@ftth-copilot/evidence`. The wire contract uses the same values so a
 * producer can emit a row without mapping.
 */
export const VerdictCodeSchema = z.enum(['ok', 'low_confidence', 'stale', 'incomplete']);
export type VerdictCode = z.infer<typeof VerdictCodeSchema>;

/**
 * Fase F — runtime guard for the `AgentResult.warnings: VerdictCode[]`
 * channel. The F-3 finalize branch populates `result.warnings` with the
 * deduped distinct `VerdictCode`s that produced the `'warn'` decision
 * (`'stale'` + `'low_confidence'`); this zod array is the single source
 * of truth for the wire shape so producers / consumers / metrics can
 * round-trip the value through `safeParse` without re-locking the enum.
 * Kept as an array (not `.nonempty()`) because the F-3 spec leaves the
 * field absent on `allow` / `abstain` paths; the empty-array case is
 * still a legal value when the runtime explicitly emits it.
 */
export const verdictCodesSchema = z.array(VerdictCodeSchema);

/**
 * VerdictSeverity — mirrored from the `VerdictSeverity` union in
 * `@ftth-copilot/evidence`. Independent dimension from `code`: code is
 * the "what happened" classification; severity is the "how loud should we
 * be" classification.
 */
export const VerdictSeveritySchema = z.enum(['ok', 'info', 'warning', 'critical']);
export type VerdictSeverity = z.infer<typeof VerdictSeveritySchema>;

/** Node kinds allowed on either side of a `TopologyEdge`. */
export const topologyNodeKindSchema = z.enum(['OLT', 'PON_PORT', 'SPLITTER', 'CTO', 'ONU']);
export type TopologyNodeKind = z.infer<typeof topologyNodeKindSchema>;

// ── evidence.provenance.v1 ──────────────────────────────────────────────────

export const evidenceProvenanceSchema = z.object({
  schema: z.literal(EVIDENCE_PROVENANCE_SCHEMA),
  source: z.string().min(1),
  tenantId: z.string().min(1),
  observedAt: z.string().datetime(),
  ttlMs: z.number().int().nonnegative(),
  completeness: z.enum(['complete', 'partial', 'minimal']),
  confidence: z.number().min(0).max(1).optional(),
  data: z.unknown(),
});

export type EvidenceProvenance = z.infer<typeof evidenceProvenanceSchema>;

// ── TTL constants ───────────────────────────────────────────────────────────

/** Default TTL for live data provenance (15 minutes). */
export const DEFAULT_TTL_MS = 15 * 60_000;
/** TTL for demo/simulated data provenance (60 minutes). */
export const DEMO_TTL_MS = 60 * 60_000;

// ── telemetry.v1 (salida de ingesta) ─────────────────────────────────────────

export const telemetrySourceSchema = z.enum(['poll', 'syslog', 'snmp-trap', 'gnmi']);

/**
 * A normalized device sample. `metrics` is deliberately open (passthrough) so a
 * new counter (e.g. a future optical metric) can be added without a breaking
 * version bump, while the fields we already reason about stay validated.
 */
export const telemetryEventSchema = z.object({
  schema: z.literal(TELEMETRY_SCHEMA),
  tenantId: z.string().min(1),
  deviceKind: z.enum(['OLT', 'ONU']),
  deviceId: z.string().min(1),
  source: telemetrySourceSchema,
  ts: z.string().datetime(),
  metrics: z
    .object({
      rx_power_dbm: z.number().optional(),
      tx_power_dbm: z.number().optional(),
      temperature_celsius: z.number().optional(),
      fec_corrected: z.number().int().nonnegative().optional(),
      fec_uncorrected: z.number().int().nonnegative().optional(),
      bias_current_ma: z.number().optional(),
    })
    .passthrough(),
  tags: z.record(z.string(), z.string()).optional(),
});

export type TelemetryEvent = z.infer<typeof telemetryEventSchema>;

// ── finding.v1 (salida de filtrado → entrada cognitiva) ──────────────────────

/**
 * External (snake_case) finding vocabulary. It maps 1:1 onto the internal
 * `FindingKind` in `@ftth-copilot/detection` (e.g. signal_drift ↔
 * predicted_low_signal); the mapping lives at the adapter boundary, not here.
 */
export const findingKindSchema = z.enum([
  'signal_drift',
  'fec_degradation',
  'optical_degradation',
  'temperature_drift',
  'intermittent_connection',
  'frequent_reboots',
  'traffic_anomaly',
  'metric_anomaly',
]);

export const findingSchema = z.object({
  schema: z.literal(FINDING_SCHEMA),
  kind: findingKindSchema,
  severity: z.enum(['warning', 'critical']),
  deviceKind: z.enum(['OLT', 'ONU']),
  deviceId: z.string().min(1),
  confidence: z.number().min(0).max(1).optional(),
  etaMs: z.number().int().nonnegative().optional(),
  evidence: z.record(z.string(), z.unknown()).optional(),
  context: z
    .object({
      tenantId: z.string().min(1),
      oltId: z.string().optional(),
      customer: z.string().optional(),
    })
    .passthrough(),
});

export type Finding = z.infer<typeof findingSchema>;

// ── action.v1 (salida de la capa cognitiva) ──────────────────────────────────

export const actionTypeSchema = z.enum(['pre_alert', 'ticket', 'workflow', 'notify']);

export const actionSchema = z.object({
  schema: z.literal(ACTION_SCHEMA),
  type: actionTypeSchema,
  incidentId: z.string().min(1),
  title: z.string().min(1),
  body: z.string().min(1),
  targets: z
    .object({
      webhook: z.boolean().optional(),
      telegram: z.boolean().optional(),
      ticketing: z.boolean().optional(),
    })
    .passthrough(),
});

export type Action = z.infer<typeof actionSchema>;

// ── ftth.abstention.v1 (Fase C — strict-mode override payload) ────────────────

/**
 * Stable JSON envelope emitted by `runAgent` in strict mode when at least one
 * `Verdict` classifies the evidence as `incomplete`. Stored under
 * `Message.toolCalls` (DB JSON column) as a synthetic `{ name: '__abstention__' }`
 * row and surfaced to the operator as a warning bubble in the ChatUI.
 *
 * - `reason` is the VerdictCode emitted by `classifyEnvelope` /
 *   `classifyUnwrapped`. Strict mode abstains only on `incomplete`; `stale`
 *   and `low_confidence` keep flowing to the LLM (warnings only).
 * - `severity` mirrors the originating incomplete verdict.
 * - `claim` is optional free-form context (e.g. the assistant's intended
 *   diagnosis). Omitted when not provided.
 * - `missing` lists the distinct toolNames that produced `incomplete` verdicts.
 * - `available` lists distinct toolNames from `ok` verdicts (may be empty when
 *   every tool in the run failed).
 * - `nextStep` is a deterministic Spanish string keyed on `reason`; rendered
 *   by the ChatUI bubble.
 * - `toolsAffected` is the union of distinct toolNames across non-`ok` verdicts;
 *   always non-empty (buildAbstention only runs when at least one incomplete
 *   verdict exists).
 */
export const abstentionSchema = z
  .object({
    schema: z.literal(ABSTENTION_SCHEMA),
    reason: z.enum(['ok', 'low_confidence', 'stale', 'incomplete']),
    severity: z.enum(['ok', 'info', 'warning', 'critical']),
    claim: z.string().optional(),
    missing: z.array(z.string().min(1)),
    available: z.array(z.string().min(1)),
    nextStep: z.string().min(1),
    toolsAffected: z.array(z.string().min(1)).min(1),
  })
  .strict();

export type Abstention = z.infer<typeof abstentionSchema>;

// ── ftth.confirmed-incident.v1 (Fase D — confirmed-incident memory) ──────────

/**
 * Stable JSON envelope for a confirmed incident. Two confirmation paths feed
 * this table (operator + agent); the sparse-first BM25 retriever in
 * `@ftth-copilot/evidence` consumes it via the `RelevantIncidentResult`
 * subtype (adds `score`).
 *
 * Fields:
 * - `schema` is the version literal — must match the producer exactly.
 * - `deviceKind` is reused from the existing OLT/ONU vocabulary.
 * - `searchTokens` is the pre-computed, lowercased, stop-word-trimmed token
 *   string that BM25 compares against the query token stream.
 * - `score` is retrieval-only and may be omitted when the row is being
 *   written to the DB (no retrieval happened yet). When present, it must be
 *   in the [0, 1] range.
 * - `embedding` is reserved for the Phase 2 pgvector dense path (currently
 *   unused; the column is nullable in the Prisma model).
 *
 * `.strict()` rejects any unknown top-level keys so a producer can never
 * silently drift the wire format.
 */
export const confirmedIncidentSchema = z
  .object({
    schema: z.literal(CONFIRMED_INCIDENT_SCHEMA),
    id: z.string().min(1),
    tenantId: z.string().min(1),
    connectionId: z.string().min(1).nullable().optional(),
    deviceKind: z.enum(['OLT', 'ONU']),
    deviceId: z.string().min(1),
    sourceIncidentId: z.string().min(1).optional(),
    sourceTool: z.string().min(1),
    summary: z.string().min(1),
    symptoms: z.unknown(),
    rootCause: z.string().min(1),
    fix: z.string().min(1),
    observedAt: z.string().datetime(),
    resolvedAt: z.string().datetime(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    confirmedBy: z.enum(['operator', 'agent', 'system']),
    confirmedByUserId: z.string().min(1).nullable().optional(),
    searchTokens: z.string(), // may be empty; the BM25 scorer handles empty intersection
    score: z.number().min(0).max(1).optional(),
    embedding: z.unknown().optional(),
  })
  .strict();

export type ConfirmedIncident = z.infer<typeof confirmedIncidentSchema>;

/**
 * A retrieval result: a `ConfirmedIncident` enriched with the BM25 (and,
 * later, dense-merge) score. Always has a `score` in [0, 1] because the
 * scorer only emits rows above `MIN_SPARSESCORE`.
 */
export type RelevantIncidentResult = ConfirmedIncident & { score: number };

// ── ftth.pending-incident-candidate.v1 (Fase D — chat-route write gate) ──────

/**
 * Stable JSON envelope for a candidate row written by the chat route after
 * a clean (non-abstained, no incomplete verdict) run in live mode. The admin
 * promotion route promotes candidates whose linked Incident has been
 * resolved ≥24h with no incomplete verdict in `toolCallsJson`.
 *
 * `sourceIncidentId` is a soft reference (no FK in Prisma) — Incidents stay
 * deletable.
 */
export const pendingIncidentCandidateSchema = z
  .object({
    schema: z.literal(PENDING_INCIDENT_CANDIDATE_SCHEMA),
    id: z.string().min(1),
    tenantId: z.string().min(1),
    sourceIncidentId: z.string().min(1).optional(),
    runSessionId: z.string().min(1).optional(),
    summary: z.string().min(1),
    toolCallsJson: z.unknown(),
    proposedConfirmedAt: z.string().datetime(),
    status: z.enum(['pending', 'promoted', 'rejected']),
    createdAt: z.string().datetime().optional(),
  })
  .strict();

export type PendingIncidentCandidate = z.infer<typeof pendingIncidentCandidateSchema>;

// ── ftth.tenant-policy.v1 (Fase E — per-tenant override envelope) ─────────────
//
// Stable JSON envelope for the optional per-tenant override row (1:1 with
// `Tenant`). The runtime consults `tenantPolicy.X ?? env.X ?? moduleDefault.X`
// per knob; absent row → Fase C/D byte-identical. Five nullable knobs are
// independent — a tenant may pin `retrievalLimit` without touching
// `promotionMinAgeMs`.
//
// Field bounds:
//   - retrievalLimit:     1..50 (top-K cap on the pre-LLM context block)
//   - retrievalSinceDays: 1..365 (recall window)
//   - truthGateMode:      'observe' | 'strict'
//   - abstainOnCodes:     subset of VerdictCode (`ok` allowed for forward-
//                         compat; runtime filters the meaningless entries)
//   - promotionMinAgeMs:  >= 0 (0 means "promote immediately")
//
// `.strict()` rejects unknown top-level keys so a future spec bump can never
// silently drift the wire format.
export const tenantPolicySchema = z
  .object({
    schema: z.literal(TENANT_POLICY_SCHEMA),
    schemaVersion: z.literal(1),
    tenantId: z.string().min(1),
    retrievalLimit: z.number().int().min(1).max(50).optional(),
    retrievalSinceDays: z.number().int().min(1).max(365).optional(),
    truthGateMode: z.enum(['observe', 'strict']).optional(),
    abstainOnCodes: z
      .array(z.enum(['ok', 'low_confidence', 'stale', 'incomplete']))
      .optional(),
    promotionMinAgeMs: z.number().int().min(0).optional(),
    lastEvaluatedAt: z.string().datetime().optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export type TenantPolicy = z.infer<typeof tenantPolicySchema>;

// ── ftth.topology-edge.v1 (Fase E — temporal topology) ───────────────────────
//
// Stable JSON envelope for a single directed edge in the FTTH hierarchy
// (OLT → PON_PORT → SPLITTER → CTO → ONU). One row per edge; the BFS
// helpers (`bfsDownstream`, `bfsAncestors`, `topologyPath`) in
// `@ftth-copilot/evidence/src/topology.ts` traverse the live graph filtered
// by `validTo === null`.
//
// Field bounds:
//   - schema         : literal `'ftth.topology-edge.v1'`
//   - id             : non-empty cuid/uuid (Prisma-side default)
//   - tenantId       : non-empty; FK to `tenants.id` in the DB
//   - parentKind / childKind : `OLT | PON_PORT | SPLITTER | CTO | ONU`
//   - parentId / childId     : non-empty device identifiers
//   - validFrom      : ISO datetime; required
//   - validTo        : ISO datetime; nullable; when set MUST be > validFrom
//   - source         : non-empty free-form (operator entry, future ingestion)
//
// `.strict()` rejects unknown top-level keys; the cross-field `refine`
// enforces `validTo > validFrom` whenever `validTo` is provided. Self-loops
// (parent == child on both sides) are allowed — the cycle guard in the BFS
// helpers prevents infinite loops. The DB layer does not enforce a unique
// constraint on (tenant, parent, child) because historical edges may
// legitimately repeat the same (parent, child) tuple with different
// `validFrom` / `validTo` windows.
export const topologyEdgeSchema = z
  .object({
    schema: z.literal(TOPOLOGY_EDGE_SCHEMA),
    id: z.string().min(1),
    tenantId: z.string().min(1),
    parentKind: topologyNodeKindSchema,
    parentId: z.string().min(1),
    childKind: topologyNodeKindSchema,
    childId: z.string().min(1),
    validFrom: z.string().datetime(),
    validTo: z.string().datetime().nullable().optional(),
    source: z.string().min(1),
    createdAt: z.string().datetime(),
  })
  .strict()
  .refine(
    (e) =>
      e.validTo == null ||
      new Date(e.validTo).getTime() > new Date(e.validFrom).getTime(),
    { message: 'validTo must be greater than validFrom', path: ['validTo'] },
  );

export type TopologyEdge = z.infer<typeof topologyEdgeSchema>;

// ── ftth.verdict-log.v1 (Fase F — verdict-log persistence surface) ────────────
//
// Wire contract for the v1 `verdict_log` Prisma table. The chat route (F-5)
// writes one row per (message, tool-call verdict) emitted by `runAgent`;
// the nightly metrics builder reads through this schema to derive
// coverage / abstention / gate-FP per tenant.
//
// Field bounds:
//   - schema         : literal `'ftth.verdict-log.v1'`
//   - id             : non-empty cuid/uuid (Prisma-side default)
//   - tenantId       : non-empty; FK to `tenants.id` in the DB
//   - messageId      : optional non-empty; FK to `messages.id` when present
//                      (absent on recompute backfill where the originating
//                      message has been deleted out from under the writer)
//   - conversationId : optional non-empty soft ref; no FK (conversations stay
//                      deletable; correlation is best-effort)
//   - toolName       : non-empty; the tool that produced the verdict
//   - code           : VerdictCode (`ok | low_confidence | stale | incomplete`)
//   - severity       : VerdictSeverity (`ok | info | warning | critical`)
//   - observedAt     : ISO datetime; when the runtime recorded the verdict
//   - injectionSuspicion : optional boolean; fast-filter bit derived from
//                      `code IN ('stale', 'low_confidence')` so the nightly
//                      `injection_suspicion_total` metric can run as a
//                      simple index scan (see design.md §Risks).
//
// `.strict()` rejects unknown top-level keys so the wire format can never
// drift across the agent-core ↔ chat-route ↔ metrics boundary. The runtime
// MUST keep the `Message.toolCalls[*].result` envelope byte-identical —
// Fase F persists to a separate table so Fase 2 may consolidate into
// `Message.verdicts Json?` without touching every read path.
export const verdictLogSchema = z
  .object({
    schema: z.literal(VERDICT_LOG_SCHEMA),
    id: z.string().min(1),
    tenantId: z.string().min(1),
    messageId: z.string().min(1).optional(),
    conversationId: z.string().min(1).optional(),
    toolName: z.string().min(1),
    code: VerdictCodeSchema,
    severity: VerdictSeveritySchema,
    observedAt: z.string().datetime(),
    injectionSuspicion: z.boolean().optional(),
  })
  .strict();

export type VerdictLog = z.infer<typeof verdictLogSchema>;

// ── ftth.injection-suspicion-export.v1 (AD-11 — nightly export) ───────────────
//
// Stable JSON envelope for the `injection_suspicion_total` derived metric.
// The nightly eval job produces this from `verdict_log` rows where
// `code IN ('stale', 'low_confidence')` (the `injectionSuspicion`
// fast-filter bit). The schema is consumed by the NOC dashboard and
// any external monitoring pipeline that subscribes to the metrics artifact.
//
// `.strict()` rejects unknown top-level keys so producers can never
// silently drift the wire format.
export const INJECTION_SUSPICION_EXPORT_SCHEMA =
  'ftth.injection-suspicion-export.v1' as const;

export const injectionSuspicionExportSchema = z
  .object({
    schema: z.literal(INJECTION_SUSPICION_EXPORT_SCHEMA),
    generatedAt: z.string().datetime(),
    total: z.number().int().nonnegative(),
    byTenant: z.record(z.string(), z.number().int().nonnegative()),
    byCode: z.record(z.string(), z.number().int().nonnegative()),
  })
  .strict();

export type InjectionSuspicionExport = z.infer<typeof injectionSuspicionExportSchema>;


// ── Cognitive investigation identifiers (Fase 0.3) ───────────────────────
//
// The roadmap-research-investigation-cognitiva introduces a new
// capability for NOC: an operator-facing "Investigar incidente" flow
// that gathers telemetry, topology, and confirmed-incident history,
// presents traceable hypotheses, proposes read-only checks, and lets
// the technician record the actual outcome. The full feature is
// delivered in phases 1-7. This file pins the *identifiers* that the
// feature will use, so subsequent phases do not invent duplicate or
// colliding strings.
//
// Schema versions are explicit so the rollout can detect a producer
// that has drifted. The shape fields below are *minimal* — they only
// describe identifiers and their lifecycle. Phase 3 will extend the
// InvestigationVersion contract with hypothesis, contradiction, and
// missing-evidence fields. Phase 1 will extend the Feedback contract
// with adjudication, label, optional real cause, and concurrency
// control.
//
// MUST:
//   - schema strings follow the existing ftth.<name>.v<rev> pattern
//   - cuid() / opaque strings only; never expose Prisma row numbers
//   - feedback is a *separate* object from the version it adjudicates;
//     technicians may evaluate an old version of the diagnosis even
//     after the run has produced a newer one
//   - all timestamps are RFC 3339 UTC (z.string().datetime())

export const INVESTIGATION_RUN_SCHEMA = 'ftth.investigation-run.v1' as const;
export const INVESTIGATION_VERSION_SCHEMA = 'ftth.investigation-version.v1' as const;
export const INVESTIGATION_FEEDBACK_SCHEMA = 'ftth.investigation-feedback.v1' as const;

// Run-level identifier: one "Investigar incidente" request from the
// operator. A run may produce one or more versions as evidence or the
// LLM response is re-collected; the run is the unit of "investigate
// again" / "show me the latest" in the UI.
export const investigationRunIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, 'run id must be opaque ascii (no slashes, no spaces)');

// Version-level identifier: one immutable snapshot of the diagnostic
// result. A run creates a new version on every material update; the
// technician may evaluate a specific version, not the run as a whole.
export const investigationVersionIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, 'version id must be opaque ascii (no slashes, no spaces)');

// Feedback-level identifier: one adjudication of one version by one
// technician. Two identical submissions from the same technician for
// the same version are deduplicated (phase 1.2 will enforce
// idempotency); distinct technicians produce distinct feedbacks.
export const investigationFeedbackIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, 'feedback id must be opaque ascii (no slashes, no spaces)');

// Run envelope (minimal): tenant, connection, incident, version
// produced. The "current" version pointer is *not* here on purpose:
// the dashboard asks for the latest version of a run explicitly so
// there is no race between read and produce. Phase 1 will add the
// status field (pending, ready, failed, expired).
export const investigationRunSchema = z
  .object({
    schema: z.literal(INVESTIGATION_RUN_SCHEMA),
    runId: investigationRunIdSchema,
    tenantId: z.string().min(1),
    connectionId: z.string().min(1).nullable(),
    incidentId: z.string().min(1).nullable(),
    requestedBy: z.string().min(1), // userId of the requesting technician
    requestedAt: z.string().datetime(),
  })
  .strict();

export type InvestigationRun = z.infer<typeof investigationRunSchema>;

// Version envelope (minimal): which run, which version index, the
// ruleset/prompt/model version that produced it, and the timestamp of
// the snapshot. Phase 3 will add: windowStart, windowEnd,
// evidenceRefs, hypotheses, contradictions, missing, suggestedChecks,
// sufficiency state. None of those fields is invented here.
export const investigationVersionSchema = z
  .object({
    schema: z.literal(INVESTIGATION_VERSION_SCHEMA),
    versionId: investigationVersionIdSchema,
    runId: investigationRunIdSchema,
    versionIndex: z.number().int().nonnegative(),
    rulesetVersion: z.string().min(1),
    promptVersion: z.string().min(1),
    modelVersion: z.string().min(1),
    snapshotAt: z.string().datetime(),
  })
  .strict();

export type InvestigationVersion = z.infer<typeof investigationVersionSchema>;

// Feedback envelope (minimal): which version was adjudicated, by whom,
// when, and which label was chosen. The label set is fixed in phase 1;
// here we declare the field as a free string so phase 0 ships without
// coupling to phase 1. Phase 1 narrows the enum.
export const investigationFeedbackSchema = z
  .object({
    schema: z.literal(INVESTIGATION_FEEDBACK_SCHEMA),
    feedbackId: investigationFeedbackIdSchema,
    versionId: investigationVersionIdSchema,
    runId: investigationRunIdSchema,
    tenantId: z.string().min(1),
    authorUserId: z.string().min(1),
    submittedAt: z.string().datetime(),
    label: z.string().min(1),
  })
  .strict();

export type InvestigationFeedback = z.infer<typeof investigationFeedbackSchema>;

// ── Phase F-3.1 — full investigation result envelope ─────────────────────────
//
// `ftth.investigation-result.v1` is the full diagnosis record. Roadmap
// 3.1 says it MUST contain: ID, tenant/conexión, incidente, versión,
// fecha de corte, ventana temporal, referencias de evidencia, hipótesis,
// contradicciones, faltantes, comprobaciones sugeridas, estado de
// suficiencia y versiones de reglas/modelo/prompt.
//
// Cada hipótesis MUST separar soporte y contraevidencia. No mostrar
// porcentajes de confianza sin calibración; usar estados explicables
// de soporte.
//
// Límites de tamaño (documentados aquí, no como magic numbers sueltos):
//   - maxEvidenceRefs = 64        — references to evidence rows.
//   - maxHypotheses     = 8        — competing hypotheses to evaluate.
//   - maxContradictions = 16       — pieces of evidence that contradict.
//   - maxMissing        = 16       — pieces of evidence we expected and lack.
//   - maxChecks         = 8        — suggested read-only checks.
//   - freeTextBytes     = 4096     — UTF-8 byte cap on free-text fields.
//   - maxWindowDays     = 30       — ventana temporal máxima permitida.

export const INVESTIGATION_RESULT_SCHEMA = 'ftth.investigation-result.v1' as const;

export const MAX_INVESTIGATION_EVIDENCE_REFS = 64;
export const MAX_INVESTIGATION_HYPOTHESES = 8;
export const MAX_INVESTIGATION_CONTRADICTIONS = 16;
export const MAX_INVESTIGATION_MISSING = 16;
export const MAX_INVESTIGATION_CHECKS = 8;
export const INVESTIGATION_FREE_TEXT_BYTES = 4096;
export const MAX_INVESTIGATION_WINDOW_DAYS = 30;

// ── Hypothesis support state (3.1: "estados explicables de soporte") ─────────
//
// Closed enum: support_level ∈ { supported, contradicted, mixed, unverified }.
// No numeric confidence — calibration has not happened yet. The
// investigation card renders these labels verbatim, the agent never
// invents a percentage.
export const hypothesisSupportLevels = [
  'supported',
  'contradicted',
  'mixed',
  'unverified',
] as const;
export type HypothesisSupportLevel = (typeof hypothesisSupportLevels)[number];

// Sufficiency state: whether the diagnosis has enough evidence to be
// actionable, or is provisional / incomplete.
export const investigationSufficiencyStates = [
  'sufficient',
  'provisional',
  'insufficient',
] as const;
export type InvestigationSufficiencyState =
  (typeof investigationSufficiencyStates)[number];

// Hypothesis support evidence (closed structure).
export const hypothesisSupportSchema = z
  .object({
    evidenceRefId: z.string().min(1).max(64), // opaque ID into the run's evidenceRefs
    weight: z.enum(['for', 'against']),
    note: z.string().max(INVESTIGATION_FREE_TEXT_BYTES).optional(),
  })
  .strict();

// Single hypothesis with explicit for/against evidence refs.
export const investigationHypothesisSchema = z
  .object({
    hypothesisId: z.string().min(1).max(64),
    summary: z.string().min(1).max(INVESTIGATION_FREE_TEXT_BYTES),
    supportLevel: z.enum(hypothesisSupportLevels),
    forRefIds: z.array(z.string().min(1).max(64)).max(MAX_INVESTIGATION_EVIDENCE_REFS),
    againstRefIds: z.array(z.string().min(1).max(64)).max(MAX_INVESTIGATION_EVIDENCE_REFS),
  })
  .strict();

// Single contradiction: an evidence ref that contradicts the consensus.
export const investigationContradictionSchema = z
  .object({
    evidenceRefId: z.string().min(1).max(64),
    note: z.string().max(INVESTIGATION_FREE_TEXT_BYTES),
  })
  .strict();

// Single missing observation: a known-gap that, if observed, would
// shift the diagnosis.
export const investigationMissingSchema = z
  .object({
    what: z.string().min(1).max(INVESTIGATION_FREE_TEXT_BYTES),
    whyItMatters: z.string().max(INVESTIGATION_FREE_TEXT_BYTES).optional(),
  })
  .strict();

// A read-only check the technician can perform to gather more
// evidence. The roadmap (regla 8) keeps NMS operations read-only:
// this enum reflects that — never include provisioning / reboots.
export const investigationCheckKinds = [
  'observe_only',
  'topology_lookup',
  'recent_events',
  'metric_history',
] as const;
export type InvestigationCheckKind = (typeof investigationCheckKinds)[number];

export const investigationCheckSchema = z
  .object({
    checkId: z.string().min(1).max(64),
    kind: z.enum(investigationCheckKinds),
    description: z.string().min(1).max(INVESTIGATION_FREE_TEXT_BYTES),
    expectedToResolve: z.string().max(INVESTIGATION_FREE_TEXT_BYTES).optional(),
  })
  .strict();

// Evidence reference (no raw data — just a pointer into the
// packages/evidence layer). The full data is recovered via the
// pointer; the investigation card shows what the evidence ref says,
// not the entire payload.
export const investigationEvidenceRefSchema = z
  .object({
    evidenceRefId: z.string().min(1).max(64),
    kind: z.enum(['metric', 'event', 'topology', 'incident_history', 'feedback']),
    source: z.string().min(1).max(256),
    observedAt: z.string().datetime(),
    summary: z.string().min(1).max(INVESTIGATION_FREE_TEXT_BYTES),
    quality: z.enum(['fresh', 'stale', 'insufficient', 'unknown', 'error']),
    qualityReason: z.string().min(1).max(64),
  })
  .strict();

// Top-level investigation result envelope.
export const investigationResultSchema = z
  .object({
    schema: z.literal(INVESTIGATION_RESULT_SCHEMA),
    resultId: z.string().min(1).max(64),
    runId: investigationRunIdSchema,
    versionId: investigationVersionIdSchema,
    tenantId: z.string().min(1),
    connectionId: z.string().min(1).nullable(),
    incidentId: z.string().min(1).nullable(),

    // Window — bounded.
    windowStart: z.string().datetime(),
    windowEnd: z.string().datetime(),
    windowDays: z.number().positive().max(MAX_INVESTIGATION_WINDOW_DAYS),

    // Snapshot date — when the diagnosis was frozen.
    cutoffAt: z.string().datetime(),

    // Rule/model/prompt versions (roadmap 3.1).
    rulesetVersion: z.string().min(1).max(64),
    modelVersion: z.string().min(1).max(64),
    promptVersion: z.string().min(1).max(64),

    // Evidence and reasoning, bounded arrays.
    evidenceRefs: z
      .array(investigationEvidenceRefSchema)
      .max(MAX_INVESTIGATION_EVIDENCE_REFS),
    hypotheses: z
      .array(investigationHypothesisSchema)
      .max(MAX_INVESTIGATION_HYPOTHESES),
    contradictions: z
      .array(investigationContradictionSchema)
      .max(MAX_INVESTIGATION_CONTRADICTIONS),
    missing: z
      .array(investigationMissingSchema)
      .max(MAX_INVESTIGATION_MISSING),
    suggestedChecks: z
      .array(investigationCheckSchema)
      .max(MAX_INVESTIGATION_CHECKS),

    // Sufficiency — closed enum, never a confidence number.
    sufficiency: z.enum(investigationSufficiencyStates),
    sufficiencyReason: z.string().min(1).max(INVESTIGATION_FREE_TEXT_BYTES),

    // Audit fields.
    producedAt: z.string().datetime(),
    producedBy: z.string().min(1).max(64), // 'agent-core@x.y.z' | 'human:<userId>'
  })
  .strict()
  .refine(
    (r) => new Date(r.windowEnd).getTime() >= new Date(r.windowStart).getTime(),
    { message: 'windowEnd must be >= windowStart', path: ['windowEnd'] },
  )
  .refine(
    (r) => new Date(r.cutoffAt).getTime() <= new Date(r.producedAt).getTime(),
    { message: 'cutoffAt must be <= producedAt', path: ['cutoffAt'] },
  );

export type InvestigationResult = z.infer<typeof investigationResultSchema>;
export type InvestigationHypothesis = z.infer<typeof investigationHypothesisSchema>;
export type InvestigationEvidenceRef = z.infer<typeof investigationEvidenceRefSchema>;
export type InvestigationContradiction = z.infer<typeof investigationContradictionSchema>;
export type InvestigationMissing = z.infer<typeof investigationMissingSchema>;
export type InvestigationCheck = z.infer<typeof investigationCheckSchema>;
