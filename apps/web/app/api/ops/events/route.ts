import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@ftth-copilot/db';
import { getCurrentUser } from '@/lib/auth/server';
import { hasPermission } from '@/lib/auth/permissions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type TimelineEvent = {
  id: string;
  kind: 'alert' | 'incident' | 'device_event' | 'change_event' | 'confirmed_incident';
  category: string;
  deviceKind: string | null;
  deviceId: string | null;
  title: string;
  severity: string;
  timestamp: string;
  message: string | null;
  /** IDs of correlated incidents (for change events) */
  correlatedIds?: string[];
  /** Link to runbook (for confirmed incidents) */
  runbookId?: string | null;
  /** For confirmed incidents: time to resolve */
  resolutionMs?: number | null;
};

/**
 * GET /api/ops/events
 *
 * Unified change timeline: aggregates DeviceEvent (syslog/traps),
 * DetectedAlert, Incident, ChangeEvent, and ConfirmedIncident
 * into a single chronological feed for the NOC operator.
 *
 * Query params:
 *   hours=48   — lookback window (default 48h)
 *   limit=100  — max events returned (default 100)
 *   kind=      — filter by kind: alert|incident|device_event|change_event|confirmed_incident
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!hasPermission(user.role, 'view_network')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const url = new URL(req.url);
  const hours = Math.min(168, Math.max(1, Number.parseInt(url.searchParams.get('hours') ?? '48', 10)));
  const limit = Math.min(500, Math.max(10, Number.parseInt(url.searchParams.get('limit') ?? '100', 10)));
  const kindFilter = url.searchParams.get('kind');
  const from = new Date(Date.now() - hours * 3_600_000);

  const [alerts, incidents, deviceEvents, changeEvents, confirmedIncidents] = await Promise.all([
    kindFilter && kindFilter !== 'alert' ? Promise.resolve([]) :
      prisma.detectedAlert.findMany({
        where: { tenantId: user.tenantId, lastSeenAt: { gte: from } },
        orderBy: { lastSeenAt: 'desc' },
        take: Math.floor(limit / 2),
        select: { id: true, deviceKind: true, deviceId: true, kind: true, severity: true, title: true, lastSeenAt: true, description: true },
      }),
    kindFilter && kindFilter !== 'incident' ? Promise.resolve([]) :
      prisma.incident.findMany({
        where: { tenantId: user.tenantId, lastSeenAt: { gte: from } },
        orderBy: { lastSeenAt: 'desc' },
        take: Math.floor(limit / 3),
        select: { id: true, deviceKind: true, deviceId: true, severity: true, title: true, lastSeenAt: true, description: true, resolvedAt: true },
      }),
    kindFilter && kindFilter !== 'device_event' ? Promise.resolve([]) :
      prisma.deviceEvent.findMany({
        where: { tenantId: user.tenantId, occurredAt: { gte: from }, category: { in: ['config_change', 'auth_failure'] } },
        orderBy: { occurredAt: 'desc' },
        take: Math.floor(limit / 4),
        select: { id: true, category: true, deviceKind: true, deviceId: true, severity: true, message: true, occurredAt: true },
      }),
    kindFilter && kindFilter !== 'change_event' ? Promise.resolve([]) :
      prisma.changeEvent.findMany({
        where: { tenantId: user.tenantId, occurredAt: { gte: from } },
        orderBy: { occurredAt: 'desc' },
        take: Math.floor(limit / 5),
        select: { id: true, category: true, deviceKind: true, deviceId: true, severity: true, title: true, description: true, occurredAt: true, correlatedIncidentIds: true },
      }),
    kindFilter && kindFilter !== 'confirmed_incident' ? Promise.resolve([]) :
      prisma.confirmedIncident.findMany({
        where: { tenantId: user.tenantId, observedAt: { gte: from } },
        orderBy: { observedAt: 'desc' },
        take: Math.floor(limit / 6),
        select: { id: true, deviceKind: true, deviceId: true, severity: true, summary: true, observedAt: true, resolvedAt: true },
      }),
  ]);

  // Build unified timeline
  const timeline: TimelineEvent[] = [];

  for (const a of (alerts ?? [])) {
    timeline.push({
      id: `alert:${a.id}`, kind: 'alert', category: a.kind,
      deviceKind: a.deviceKind, deviceId: a.deviceId,
      title: a.title, severity: a.severity,
      timestamp: a.lastSeenAt.toISOString(), message: a.description ?? null,
    });
  }

  for (const inc of (incidents ?? [])) {
    timeline.push({
      id: `incident:${inc.id}`, kind: 'incident', category: 'incident',
      deviceKind: inc.deviceKind, deviceId: inc.deviceId,
      title: inc.title, severity: inc.severity,
      timestamp: inc.lastSeenAt.toISOString(), message: inc.description ?? null,
      resolutionMs: inc.resolvedAt ? inc.resolvedAt.getTime() - inc.lastSeenAt.getTime() : null,
    });
  }

  for (const ev of (deviceEvents ?? [])) {
    timeline.push({
      id: `event:${ev.id}`, kind: 'device_event', category: ev.category,
      deviceKind: ev.deviceKind ?? null, deviceId: ev.deviceId ?? null,
      title: `[${ev.category}] ${ev.deviceId ?? 'unknown'}`,
      severity: ev.severity != null && ev.severity >= 4 ? 'critical' : 'info',
      timestamp: ev.occurredAt.toISOString(), message: ev.message ?? null,
    });
  }

  for (const ce of (changeEvents ?? [])) {
    timeline.push({
      id: `change:${ce.id}`, kind: 'change_event', category: ce.category,
      deviceKind: ce.deviceKind ?? null, deviceId: ce.deviceId ?? null,
      title: ce.title, severity: ce.severity,
      timestamp: ce.occurredAt.toISOString(), message: ce.description ?? null,
      correlatedIds: ce.correlatedIncidentIds ?? [],
    });
  }

  for (const ci of (confirmedIncidents ?? [])) {
    timeline.push({
      id: `confirmed:${ci.id}`, kind: 'confirmed_incident', category: 'confirmed',
      deviceKind: ci.deviceKind, deviceId: ci.deviceId,
      title: ci.summary.slice(0, 120), severity: ci.severity,
      timestamp: ci.observedAt.toISOString(), message: null,
      resolutionMs: ci.resolvedAt ? ci.resolvedAt.getTime() - ci.observedAt.getTime() : null,
    });
  }

  // Sort descending (newest first), take limit
  timeline.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  const sliced = timeline.slice(0, limit);

  return NextResponse.json({
    timeline: sliced,
    summary: {
      total: sliced.length,
      byKind: {
        alert: sliced.filter(e => e.kind === 'alert').length,
        incident: sliced.filter(e => e.kind === 'incident').length,
        device_event: sliced.filter(e => e.kind === 'device_event').length,
        change_event: sliced.filter(e => e.kind === 'change_event').length,
        confirmed_incident: sliced.filter(e => e.kind === 'confirmed_incident').length,
      },
      lookbackHours: hours,
    },
  });
}
