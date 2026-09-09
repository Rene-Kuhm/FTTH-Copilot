import { prisma } from '@ftth-copilot/db';
import {
  collectInvestigationEvidence,
  type MetricEvidenceInput,
  type EventEvidenceInput,
  type TopologyEvidenceInput,
  type IncidentHistoryEvidenceInput,
  type FeedbackEvidenceInput,
} from '@ftth-copilot/evidence';
import {
  investigateIncident,
  validateInvestigationResult,
} from '@ftth-copilot/agent-core';
import type { InvestigationResult } from '@ftth-copilot/shared';

export interface RunInvestigationPipelineArgs {
  tenantId: string;
  incidentId: string;
  runId: string;
  versionId: string;
  deviceId: string;
  deviceKind: string;
  connectionId: string | null;
  windowDays?: number;
}

/**
 * Orchestrates the end-to-end evidence collection, cognitive investigation,
 * and server-side validation for an incident.
 */
export async function runInvestigationPipeline(
  args: RunInvestigationPipelineArgs,
): Promise<InvestigationResult> {
  const windowDays = Math.min(Math.max(args.windowDays ?? 7, 1), 30);
  const now = new Date();
  const windowEnd = now.toISOString();
  const windowStart = new Date(now.getTime() - windowDays * 86400000).toISOString();

  // 1. Gather raw evidence from database
  const [metricRows, eventRows, edgeRows, confirmedRows, feedbackRows] = await Promise.all([
    prisma.metricSample.findMany({
      where: {
        tenantId: args.tenantId,
        deviceId: args.deviceId,
        sampledAt: { gte: new Date(windowStart), lte: new Date(windowEnd) },
      },
      orderBy: { sampledAt: 'desc' },
      take: 60,
    }),
    prisma.deviceEvent.findMany({
      where: {
        tenantId: args.tenantId,
        occurredAt: { gte: new Date(windowStart), lte: new Date(windowEnd) },
      },
      orderBy: { occurredAt: 'desc' },
      take: 40,
    }),
    prisma.topologyEdge.findMany({
      where: {
        tenantId: args.tenantId,
        validTo: null,
      },
      take: 20,
    }),
    prisma.confirmedIncident.findMany({
      where: {
        tenantId: args.tenantId,
        deviceId: args.deviceId,
      },
      orderBy: { observedAt: 'desc' },
      take: 10,
    }),
    prisma.investigationFeedback.findMany({
      where: {
        tenantId: args.tenantId,
      },
      orderBy: { submittedAt: 'desc' },
      take: 10,
    }),
  ]);

  // 2. Map DB rows to collector input formats
  const metrics: MetricEvidenceInput[] = metricRows
    .filter((m) => m.value !== null)
    .map((m) => ({
      sampleId: m.id,
      tenantId: m.tenantId,
      deviceId: m.deviceId,
      metricKind: m.kind,
      value: m.value as number,
      recordedAt: m.sampledAt,
      source: `telemetry:${m.kind.toLowerCase()}`,
    }));

  const events: EventEvidenceInput[] = eventRows.map((e) => ({
    eventId: e.id,
    tenantId: e.tenantId,
    deviceId: args.deviceId,
    category: e.category,
    message: e.message,
    observedAt: e.occurredAt,
    source: e.sourceIp ? `syslog:${e.sourceIp}` : 'syslog:device',
  }));

  const topologyHops: TopologyEvidenceInput[] = edgeRows.map((edge, idx) => ({
    tenantId: edge.tenantId,
    sourceKind: edge.parentKind,
    sourceId: edge.parentId,
    targetKind: edge.childKind,
    targetId: edge.childId,
    depth: idx + 1,
  }));

  const confirmedIncidents: IncidentHistoryEvidenceInput[] = confirmedRows.map((c) => ({
    incidentId: c.id,
    tenantId: c.tenantId,
    deviceId: c.deviceId,
    summary: c.summary,
    rootCause: c.rootCause,
    fix: c.fix,
    resolvedAt: c.resolvedAt,
  }));

  const feedbacks: FeedbackEvidenceInput[] = feedbackRows
    .filter((f): f is typeof f & { label: 'confirmed' | 'incorrect' | 'insufficient_data' } =>
      ['confirmed', 'incorrect', 'insufficient_data'].includes(f.label),
    )
    .map((f) => ({
      feedbackId: f.feedbackId,
      tenantId: f.tenantId,
      runId: f.runId,
      versionId: f.versionId,
      label: f.label,
      observations: f.observations,
      realCause: f.realCause,
      submittedAt: f.submittedAt,
    }));

  // 3. Deterministic evidence collection via @ftth-copilot/evidence
  const evidenceRefs = collectInvestigationEvidence({
    tenantId: args.tenantId,
    deviceId: args.deviceId,
    connectionId: args.connectionId,
    incidentId: args.incidentId,
    windowStart,
    windowEnd,
    metrics,
    events,
    topologyHops,
    confirmedIncidents,
    feedbacks,
  });

  // 4. Cognitive investigation engine via @ftth-copilot/agent-core
  const rawResult = await investigateIncident({
    tenantId: args.tenantId,
    connectionId: args.connectionId,
    incidentId: args.incidentId,
    runId: args.runId,
    versionId: args.versionId,
    windowStart,
    windowEnd,
    evidenceRefs,
  });

  // 5. Server-side validation gate via @ftth-copilot/agent-core
  const validationReport = validateInvestigationResult(rawResult, {
    expectedTenantId: args.tenantId,
  });

  return validationReport.sanitizedResult;
}
