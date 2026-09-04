/**
 * Tipos compartidos entre el agente y el frontend.
 */
import type { Verdict, VerdictCode } from '@ftth-copilot/evidence';
import type { Abstention } from './contracts';

export interface ToolCallRecord {
  name: string;
  arguments: Record<string, unknown>;
  result?: unknown;
}

export interface AgentResult {
  text: string;
  toolCalls: ToolCallRecord[];
  /**
   * Optional verdicts from `@ftth-copilot/evidence`'s TruthGate
   * (Fase B). Each tool call produces one verdict; classification is
   * observe-mode (data still flows to the LLM). Omission is valid for
   * pre-Fase-B results.
   */
  verdicts?: Verdict[];
  /**
   * Optional `ftth.abstention.v1` envelope (Fase C). Present only when the
   * TruthGate ran in `strict` mode and at least one verdict classified the
   * evidence as `incomplete`. Omission is valid for observe-mode runs and
   * for every pre-Fase-C result.
   */
  abstention?: Abstention;
  /**
   * `true` when `text` is the abstention rendering instead of the LLM's own
   * answer. Always paired with `abstention`. Omitted (not `false`) when the
   * agent answered normally, so existing consumers stay untouched.
   */
  abstained?: boolean;
  /**
   * Fase F (F-3) — additive warn channel. Populated by the F-3
   * `finalize` branch in `@ftth-copilot/agent-core` only when
   * `shouldAbstain(...) === 'warn'` (i.e. at least one verdict carries
   * `'stale'` or `'low_confidence'` and none carries `'incomplete'`).
   *
   * Wire shape: deduped distinct `VerdictCode[]` from the warn verdicts
   * (typically `['stale']`, `['low_confidence']`, or
   * `['stale', 'low_confidence']`). Runtime-validated through
   * `verdictCodesSchema` in `@ftth-copilot/shared`.
   *
   * Invariants:
   * - `result.text` is byte-identical to the LLM output on this path;
   *   the warn channel NEVER rewrites the LLM string (see F-3 design
   *   §Architecture Decisions #3 and the
   *   `injection-defense.spec.md` "Warn preserves LLM text" scenario).
   * - `result.abstention` stays `undefined` and `result.abstained`
   *   stays `undefined` — the warn channel is observability-only and
   *   never co-fires with the Fase C abstention envelope.
   * - On the `'abstain'` path, `warnings` stays `undefined` (the
   *   abstain path supersedes the warn channel).
   * - On the `'allow'` path, `warnings` stays `undefined`.
   * - Omission is valid for every pre-Fase-F consumer; the field is
   *   strictly additive.
   */
  warnings?: VerdictCode[];
}

export interface ChatRequest {
  message: string;
  conversationId?: string;
}

export interface ChatResponse {
  reply: string;
  toolsUsed: Array<{
    name: string;
    args: Record<string, unknown>;
  }>;
  conversationId?: string;
  /**
   * Abstention envelope forwarded verbatim from `AgentResult.abstention`
   * (Fase C) so the client can render the warning bubble. Optional: absent
   * whenever the agent answered normally.
   */
  abstention?: Abstention;
}

export * from './contracts';
export type {
  EvidenceProvenance,
  Abstention,
  ConfirmedIncident,
  PendingIncidentCandidate,
  RelevantIncidentResult,
  TenantPolicy,
  TopologyEdge,
  TopologyNodeKind,
  VerdictLog,
  VerdictCode,
  VerdictSeverity,
} from './contracts';
export {
  EVIDENCE_PROVENANCE_SCHEMA,
  evidenceProvenanceSchema,
  ABSTENTION_SCHEMA,
  abstentionSchema,
  CONFIRMED_INCIDENT_SCHEMA,
  PENDING_INCIDENT_CANDIDATE_SCHEMA,
  confirmedIncidentSchema,
  pendingIncidentCandidateSchema,
  TENANT_POLICY_SCHEMA,
  tenantPolicySchema,
  TOPOLOGY_EDGE_SCHEMA,
  topologyEdgeSchema,
  topologyNodeKindSchema,
  VERDICT_LOG_SCHEMA,
  verdictLogSchema,
  VerdictCodeSchema,
  verdictCodesSchema,
  VerdictSeveritySchema,
  DEFAULT_TTL_MS,
  DEMO_TTL_MS,
} from './contracts';
