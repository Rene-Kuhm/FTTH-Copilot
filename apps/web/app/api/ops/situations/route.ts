import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@ftth-copilot/db';
import { correlateByTopologyAndTime } from '@ftth-copilot/evidence';
import {
  extractFeatures,
  scoreSituation,
  defaultWeights,
  type SituationFeatures,
} from '@ftth-copilot/analytics';
import { topologyNodeKindSchema, type TopologyCorrelationEvent, type TopologyCorrelationConfig } from '@ftth-copilot/shared';
import { getCurrentUser } from '@/lib/auth/server';
import { hasPermission } from '@/lib/auth/permissions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CORRELATION_CONFIG: TopologyCorrelationConfig = {
  timeWindowMs: 30 * 60 * 1000, // 30-minute window
  minAffectedCount: 2,
  minAffectedRatio: 0.05, // ≥5% of downstream affected
  targetAncestorKinds: ['OLT', 'PON_PORT', 'SPLITTER', 'CTO'],
};

/**
 * GET /api/ops/situations
 *
 * Returns correlated "situations" — groups of related events that share
 * a common upstream topology ancestor (OLT, PON port, splitter, CTO).
 *
 * This collapses alert storms (e.g. 200 ONU drops under the same OLT)
 * into a single situation for the NOC operator.
 *
 * Response shape:
 *   { situations: TopologyCorrelationGroup[], alerts: DetectedAlert[],
 *     incidents: Incident[], deviceEvents: DeviceEvent[] }
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!hasPermission(user.role, 'view_network')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const url = new URL(req.url);
  const hoursParam = Number.parseInt(url.searchParams.get('hours') ?? '6', 10);
  const hours = Math.min(72, Math.max(1, hoursParam));
  const from = new Date(Date.now() - hours * 3_600_000);

  // ── 1. Pull raw events from all three sources ──────────────────────
  const [alerts, incidents, deviceEvents, edges] = await Promise.all([
    prisma.detectedAlert.findMany({
      where: {
        tenantId: user.tenantId,
        lastSeenAt: { gte: from },
        status: { in: ['open', 'acknowledged'] },
      },
      select: {
        id: true, deviceKind: true, deviceId: true, kind: true,
        severity: true, title: true, lastSeenAt: true,
      },
    }),
    prisma.incident.findMany({
      where: {
        tenantId: user.tenantId,
        lastSeenAt: { gte: from },
        status: { in: ['open', 'acknowledged'] },
      },
      select: {
        id: true, deviceKind: true, deviceId: true,
        severity: true, title: true, lastSeenAt: true,
      },
    }),
    prisma.deviceEvent.findMany({
      where: {
        tenantId: user.tenantId,
        occurredAt: { gte: from },
      },
      select: {
        id: true, category: true, deviceKind: true, deviceId: true,
        severity: true, message: true, facility: true,
        sourceIp: true, occurredAt: true,
      },
    }),
    prisma.topologyEdge.findMany({
      where: { tenantId: user.tenantId, validTo: null },
      select: {
        id: true, tenantId: true, parentKind: true, parentId: true,
        childKind: true, childId: true, validFrom: true, validTo: true,
        source: true, createdAt: true,
      },
    }),
  ]);

  // ── 2. Convert to TopologyCorrelationEvent[] ──────────────────────
  const events: TopologyCorrelationEvent[] = [];

  for (const a of alerts) {
    const dk = topologyNodeKindSchema.safeParse(a.deviceKind);
    if (dk.success) {
      events.push({
        tenantId: user.tenantId,
        deviceId: a.deviceId,
        deviceKind: dk.data,
        timestamp: a.lastSeenAt.toISOString(),
        sourceEventId: `alert:${a.id}`,
        severity: a.severity === 'critical' ? 'critical' : 'warning',
        category: a.kind,
        message: a.title,
      });
    }
  }

  for (const inc of incidents) {
    const dk = topologyNodeKindSchema.safeParse(inc.deviceKind);
    if (dk.success) {
      events.push({
        tenantId: user.tenantId,
        deviceId: inc.deviceId,
        deviceKind: dk.data,
        timestamp: inc.lastSeenAt.toISOString(),
        sourceEventId: `incident:${inc.id}`,
        severity: inc.severity === 'critical' ? 'critical' : 'warning',
        category: 'incident',
        message: inc.title,
      });
    }
  }

  for (const ev of deviceEvents) {
    // Skip noise categories; include config_change, auth_failure, access events
    if (ev.category === 'other') continue;
    const dk = ev.deviceKind
      ? topologyNodeKindSchema.safeParse(ev.deviceKind)
      : null;
    if (!ev.deviceId) continue;
    events.push({
      tenantId: user.tenantId,
      deviceId: ev.deviceId,
      deviceKind: dk?.success ? dk.data : 'ONU',
      timestamp: ev.occurredAt.toISOString(),
      sourceEventId: `event:${ev.id}`,
      severity: ev.severity != null && ev.severity >= 4 ? 'critical' : 'warning',
      category: ev.category,
      message: ev.message.slice(0, 200),
    });
  }

  // ── 3. Correlate ─────────────────────────────────────────────────
  // Map Prisma rows → TopologyEdge (safe-parse each row; skip invalid)
  const topologyEdges = edges
    .map(row => {
      const parentKind = topologyNodeKindSchema.safeParse(row.parentKind);
      const childKind = topologyNodeKindSchema.safeParse(row.childKind);
      if (!parentKind.success || !childKind.success) return null;
      return {
        schema: 'ftth.topology-edge.v1' as const,
        id: row.id,
        tenantId: row.tenantId,
        parentKind: parentKind.data,
        parentId: row.parentId,
        childKind: childKind.data,
        childId: row.childId,
        validFrom: row.validFrom.toISOString(),
        validTo: row.validTo?.toISOString() ?? null,
        source: row.source,
        createdAt: row.createdAt.toISOString(),
      };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null);

  const situations = correlateByTopologyAndTime(events, topologyEdges, CORRELATION_CONFIG, user.tenantId);

  // ── Learned confidence ──────────────────────────────────────────────
  // The correlator says which events belong together; the scorer says how much to
  // believe that grouping. Anomalies from the RBCD detector that overlap a situation
  // window are fed in as independent corroboration, and the tenant's learned weights
  // rank the result, so the ordering reflects this installation's own history rather
  // than a fixed heuristic.
  const [weightsRow, anomalies] = await Promise.all([
    prisma.correlationWeight.findUnique({ where: { tenantId: user.tenantId } }),
    prisma.correlationOutcome.findMany({
      where: { tenantId: user.tenantId, windowStart: { gte: from } },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: { windowStart: true, windowEnd: true, confirmed: true, metricKey: true },
    }),
  ]);

  // Prisma types a Json column as any JSON value, so narrow it before spreading:
  // a stored primitive would otherwise blow up the spread.
  const storedWeights = (weightsRow?.weights ?? {}) as Partial<Record<keyof SituationFeatures, number>>;
  const weights: Record<keyof SituationFeatures, number> = {
    ...defaultWeights(),
    ...Object.fromEntries(
      Object.entries(storedWeights).filter(
        (entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]),
      ),
    ),
  };

  const scored = situations.map((s) => {
    const start = new Date(s.windowStart).getTime();
    const end = new Date(s.windowEnd).getTime();

    // Anomalies that overlap the situation window in time.
    const overlapping = anomalies
      .filter((a) => {
        const aStart = new Date(a.windowStart).getTime();
        const aEnd = new Date(a.windowEnd).getTime();
        return aStart <= end && aEnd >= start;
      })
      .map((a, i) => ({ key: a.metricKey ?? 'unknown', startIndex: i, endIndex: i }));

    const features = extractFeatures(
      {
        ancestorKind: s.ancestorKind,
        ancestorId: s.ancestorId,
        windowStart: s.windowStart,
        windowEnd: s.windowEnd,
        affectedRatio: s.affectedRatio,
        affectedCount: s.affectedCount,
        totalPopulation: s.totalPopulation,
        events: events
          .filter((e) => e.sourceEventId && s.evidenceEventIds.includes(e.sourceEventId))
          .map((e) => ({
            sourceEventId: e.sourceEventId!,
            deviceId: e.deviceId,
            deviceKind: e.deviceKind,
            timestamp: e.timestamp,
            // TopologyCorrelationEvent carries `category` rather than a typed
            // source/alert pair. It serves both roles here: distinct categories give
            // evidence diversity, and agreement on one category gives kind agreement.
            sourceKind: e.category ?? 'unknown',
            alertKind: e.category ?? undefined,
            severity: e.severity,
          })),
      },
      overlapping,
    );

    const score = scoreSituation(features, weights);

    return {
      ...s,
      confidence: Number(score.confidence.toFixed(4)),
      scoreSeverity: score.severity,
      anomalyCorroboration: overlapping.length,
      topContributions: score.contributions
        .filter((c) => c.contribution > 0)
        .sort((a, b) => b.contribution - a.contribution)
        .slice(0, 3)
        .map((c) => ({ feature: c.feature, contribution: Number(c.contribution.toFixed(4)) })),
    };
  });

  // Most trusted situation first.
  scored.sort((a, b) => b.confidence - a.confidence);

  return NextResponse.json({
    situations: scored,
    summary: {
      totalSituations: scored.length,
      criticalSituations: scored.filter(s => s.scoreSeverity === 'critical' || s.affectedRatio >= 0.2).length,
      highConfidence: scored.filter(s => s.confidence >= 0.7).length,
      totalEvents: events.length,
      windowHours: hours,
      /** How many labelled outcomes the tenant's weights have been trained on. */
      learnedFrom: weightsRow?.sampleCount ?? 0,
    },
  });
}
