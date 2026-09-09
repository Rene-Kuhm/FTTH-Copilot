/**
 * Cognitive investigation evidence collector — pure functions for gathering,
 * windowing, isolating, and quality-scoring evidence references (Roadmap Fase 3, 3.2).
 *
 * This module is pure TypeScript (Prisma-free, DB-free). Callers in @ftth-copilot/agent-core
 * or apps/web fetch the candidate rows and pass them to collectInvestigationEvidence,
 * which enforces:
 *  1. Multi-tenant isolation (foreign tenant rows discarded).
 *  2. Temporal window invariants and sample filtering (<= 30 days).
 *  3. Telemetry quality evaluation via evidence-quality (fresh / stale).
 *  4. Demarcation of confirmed incident history as background context, never proof.
 *  5. Hard size cap to MAX_INVESTIGATION_EVIDENCE_REFS (64).
 *  6. Deterministic ordering.
 */

import {
  type InvestigationEvidenceRef,
  MAX_INVESTIGATION_EVIDENCE_REFS,
  MAX_INVESTIGATION_WINDOW_DAYS,
} from '@ftth-copilot/shared';
import { DEFAULT_SOURCE_POLICIES } from './evidence-quality';

export class MissingTenantError extends Error {
  constructor(message = 'collectInvestigationEvidence requires a non-empty tenantId') {
    super(message);
    this.name = 'MissingTenantError';
  }
}

export interface MetricEvidenceInput {
  sampleId?: string;
  tenantId: string;
  deviceId: string;
  metricKind: string;
  value: number;
  unit?: string;
  recordedAt: string | Date;
  source?: string;
}

export interface EventEvidenceInput {
  eventId?: string;
  tenantId: string;
  deviceId: string;
  category: string;
  message: string;
  observedAt: string | Date;
  source?: string;
}

export interface TopologyEvidenceInput {
  tenantId: string;
  sourceKind: string;
  sourceId: string;
  targetKind: string;
  targetId: string;
  depth?: number;
  observedAt?: string | Date;
}

export interface IncidentHistoryEvidenceInput {
  incidentId: string;
  tenantId: string;
  deviceId: string;
  summary: string;
  rootCause?: string;
  fix?: string;
  resolvedAt: string | Date;
}

export interface FeedbackEvidenceInput {
  feedbackId: string;
  tenantId: string;
  runId: string;
  versionId: string;
  label: 'confirmed' | 'incorrect' | 'insufficient_data';
  observations?: string | null;
  realCause?: string | null;
  submittedAt: string | Date;
}

export interface CollectEvidenceArgs {
  tenantId: string;
  deviceId: string;
  connectionId?: string | null;
  incidentId?: string | null;
  windowStart: string;
  windowEnd: string;
  cutoffAt?: string;
  metrics?: MetricEvidenceInput[];
  events?: EventEvidenceInput[];
  topologyHops?: TopologyEvidenceInput[];
  confirmedIncidents?: IncidentHistoryEvidenceInput[];
  feedbacks?: FeedbackEvidenceInput[];
}

function toIsoString(val: string | Date): string {
  const d = typeof val === 'string' ? new Date(val) : val;
  return d.toISOString();
}

function toTimestampMs(val: string | Date): number {
  return typeof val === 'string' ? new Date(val).getTime() : val.getTime();
}

/**
 * Collects and normalizes raw evidence candidates into a strictly bounded,
 * schema-valid array of InvestigationEvidenceRef.
 */
export function collectInvestigationEvidence(args: CollectEvidenceArgs): InvestigationEvidenceRef[] {
  const tenantId = args.tenantId?.trim();
  if (!tenantId) {
    throw new MissingTenantError();
  }

  const startMs = new Date(args.windowStart).getTime();
  const endMs = new Date(args.windowEnd).getTime();

  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    throw new Error('collectInvestigationEvidence: invalid window timestamp format');
  }

  if (endMs < startMs) {
    throw new Error('collectInvestigationEvidence: windowEnd must be >= windowStart');
  }

  const windowDays = (endMs - startMs) / (24 * 60 * 60 * 1000);
  if (windowDays > MAX_INVESTIGATION_WINDOW_DAYS) {
    throw new Error(
      `collectInvestigationEvidence: windowDays (${windowDays.toFixed(1)}) exceeds MAX_INVESTIGATION_WINDOW_DAYS (${MAX_INVESTIGATION_WINDOW_DAYS})`,
    );
  }

  const cutoffMs = args.cutoffAt ? new Date(args.cutoffAt).getTime() : endMs;
  const collected: InvestigationEvidenceRef[] = [];

  // 1. Metric Telemetry Samples
  if (args.metrics && args.metrics.length > 0) {
    const defaultPolicy = DEFAULT_SOURCE_POLICIES[0]!;
    for (let i = 0; i < args.metrics.length; i++) {
      const m = args.metrics[i]!;
      if (m.tenantId !== tenantId) continue;

      const t = toTimestampMs(m.recordedAt);
      if (t < startMs || t > endMs) continue;

      const ageMs = Math.max(0, cutoffMs - t);
      const policy =
        DEFAULT_SOURCE_POLICIES.find((p) => p.source === (m.source ?? 'smartolt.poll')) ??
        defaultPolicy;

      let quality: InvestigationEvidenceRef['quality'] = 'fresh';
      let qualityReason = 'fresh';

      if (t > cutoffMs + 60_000) {
        quality = 'error';
        qualityReason = 'future-sample';
      } else if (ageMs > policy.ttlMs) {
        quality = 'stale';
        qualityReason = 'stale';
      }

      const idSuffix = m.sampleId ?? `m_${i}`;
      const refId = `ev_metric_${idSuffix}`.slice(0, 64);
      const unitPart = m.unit ? ` ${m.unit}` : '';
      const summary = `[${m.metricKind}] ${m.value}${unitPart} en ${m.deviceId}`;

      collected.push({
        evidenceRefId: refId,
        kind: 'metric',
        source: m.source ?? 'smartolt.poll',
        observedAt: toIsoString(m.recordedAt),
        summary,
        quality,
        qualityReason,
      });
    }
  }

  // 2. Device Syslog Events
  if (args.events && args.events.length > 0) {
    for (let i = 0; i < args.events.length; i++) {
      const e = args.events[i]!;
      if (e.tenantId !== tenantId) continue;

      const t = toTimestampMs(e.observedAt);
      if (t < startMs || t > endMs) continue;

      const idSuffix = e.eventId ?? `e_${i}`;
      const refId = `ev_event_${idSuffix}`.slice(0, 64);
      const summary = `[Evento: ${e.category}] ${e.message}`;

      collected.push({
        evidenceRefId: refId,
        kind: 'event',
        source: e.source ?? 'syslog',
        observedAt: toIsoString(e.observedAt),
        summary,
        quality: 'fresh',
        qualityReason: 'event-logged',
      });
    }
  }

  // 3. Network Topology Hops
  if (args.topologyHops && args.topologyHops.length > 0) {
    for (let i = 0; i < args.topologyHops.length; i++) {
      const h = args.topologyHops[i]!;
      if (h.tenantId !== tenantId) continue;

      const refId = `ev_topo_${h.sourceId}_${h.targetId}`.slice(0, 64);
      const depth = h.depth ?? 1;
      const summary = `[Topología Hop] ${h.sourceKind}:${h.sourceId} -> ${h.targetKind}:${h.targetId} (nivel ${depth})`;
      const observedAt = h.observedAt ? toIsoString(h.observedAt) : toIsoString(args.windowEnd);

      collected.push({
        evidenceRefId: refId,
        kind: 'topology',
        source: 'topology.network',
        observedAt,
        summary,
        quality: 'fresh',
        qualityReason: 'topology-active',
      });
    }
  }

  // 4. Historical Confirmed Incidents (Background Context)
  if (args.confirmedIncidents && args.confirmedIncidents.length > 0) {
    for (let i = 0; i < args.confirmedIncidents.length; i++) {
      const inc = args.confirmedIncidents[i]!;
      if (inc.tenantId !== tenantId) continue;

      const refId = `ev_hist_${inc.incidentId}`.slice(0, 64);
      const causePart = inc.rootCause ? ` (Causa previa: ${inc.rootCause})` : '';
      const fixPart = inc.fix ? ` (Resolución: ${inc.fix})` : '';
      const summary = `[Contexto Histórico] Incidente ${inc.incidentId}: ${inc.summary}${causePart}${fixPart}`;

      collected.push({
        evidenceRefId: refId,
        kind: 'incident_history',
        source: 'confirmed-incidents.memory',
        observedAt: toIsoString(inc.resolvedAt),
        summary,
        quality: 'fresh',
        qualityReason: 'confirmed-record',
      });
    }
  }

  // 5. Historical Adjudications / Feedback
  if (args.feedbacks && args.feedbacks.length > 0) {
    for (let i = 0; i < args.feedbacks.length; i++) {
      const fb = args.feedbacks[i]!;
      if (fb.tenantId !== tenantId) continue;

      const refId = `ev_fb_${fb.feedbackId}`.slice(0, 64);
      const realCausePart = fb.realCause ? ` (Causa informada: ${fb.realCause})` : '';
      const obsPart = fb.observations ? ` - ${fb.observations}` : '';
      const summary = `[Feedback Previo] Dictamen: ${fb.label}${realCausePart}${obsPart}`;

      collected.push({
        evidenceRefId: refId,
        kind: 'feedback',
        source: 'investigation-feedback.audit',
        observedAt: toIsoString(fb.submittedAt),
        summary,
        quality: 'fresh',
        qualityReason: 'operator-adjudicated',
      });
    }
  }

  // Deterministic sorting:
  // 1. observedAt descending (most recent first)
  // 2. kind ascending
  // 3. evidenceRefId ascending
  collected.sort((a, b) => {
    const timeDiff = new Date(b.observedAt).getTime() - new Date(a.observedAt).getTime();
    if (timeDiff !== 0) return timeDiff;
    const kindDiff = a.kind.localeCompare(b.kind);
    if (kindDiff !== 0) return kindDiff;
    return a.evidenceRefId.localeCompare(b.evidenceRefId);
  });

  // Strict bounding to MAX_INVESTIGATION_EVIDENCE_REFS (64)
  return collected.slice(0, MAX_INVESTIGATION_EVIDENCE_REFS);
}
