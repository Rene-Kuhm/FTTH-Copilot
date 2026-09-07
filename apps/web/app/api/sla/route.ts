import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@ftth-copilot/db';
import { computeUptime } from '@ftth-copilot/analytics';
import { getCurrentUser } from '@/lib/auth/server';
import { hasPermission } from '@/lib/auth/permissions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DAY_MS = 24 * 60 * 60 * 1000;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!hasPermission(user.role, 'view_network')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const daysParam = Number.parseInt(req.nextUrl.searchParams.get('days') ?? '30', 10);
  const days = Number.isFinite(daysParam) ? Math.min(90, Math.max(1, daysParam)) : 30;
  const to = Date.now();
  const from = to - days * DAY_MS;

  const rows = await prisma.metricSample.findMany({
    where: {
      tenantId: user.tenantId,
      kind: 'STATUS',
      sampledAt: { gte: new Date(from), lte: new Date(to) },
    },
    orderBy: { sampledAt: 'asc' },
    select: { connectionId: true, deviceKind: true, deviceId: true, valueText: true, sampledAt: true },
  });

  // Group by (connectionId, deviceKind, deviceId) — the connectionId is a
  // PRIMARY axis of the group, not metadata. Two connections can carry
  // the same deviceId (e.g. ISP with two OLTs that both report an ONU
  // numbered 123 in their local namespace), and the previous key
  // `${deviceKind}:${deviceId}` silently merged them. With the fix,
  // each (connection, device) pair is reported on its own row.
  type Group = {
    connectionId: string | null;
    deviceKind: string;
    deviceId: string;
    samples: Array<{ t: number; status: 'online' | 'offline' | 'degraded' }>;
  };
  const groups = new Map<string, Group>();

  for (const row of rows) {
    if (row.valueText !== 'online' && row.valueText !== 'offline' && row.valueText !== 'degraded') {
      continue;
    }
    const key = `${row.connectionId ?? 'null'}:${row.deviceKind}:${row.deviceId}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        connectionId: row.connectionId,
        deviceKind: row.deviceKind,
        deviceId: row.deviceId,
        samples: [],
      };
      groups.set(key, group);
    }
    group.samples.push({ t: row.sampledAt.getTime(), status: row.valueText });
  }

  const sla = [...groups.values()].map((group) => {
    const uptime = computeUptime(group.samples, { from, to });
    // Preserve `null` for "insufficient data" instead of coercing to 0.
    // `0` means the device was monitored and offline for the whole
    // measured window — a real signal. `null` means we have no
    // measured time at all (e.g. a single same-day sample). The two
    // are different operational states and the dashboard must show
    // them differently. The sort below already pushes nulls to the
    // end, so this is safe for the ordering.
    const uptimePercent: number | null =
      uptime && uptime.uptimePercent !== null
        ? Math.round(uptime.uptimePercent * 100) / 100
        : null;
    const coveragePercent: number | null = uptime
      ? Math.round(uptime.coveragePercent * 100) / 100
      : null;
    return {
      connectionId: group.connectionId,
      deviceKind: group.deviceKind,
      deviceId: group.deviceId,
      uptimePercent,
      coveragePercent,
      measuredMs: uptime?.measuredMs ?? null,
      unmeasuredMs: uptime?.unmeasuredMs ?? null,
      offlineMs: uptime?.offlineMs ?? null,
    };
  });

  // Sort: null uptimePercent (insufficient data) to the end; otherwise
  // ascending by uptimePercent so the worst SLA lands at the top.
  sla.sort((a, b) => {
    if (a.uptimePercent === null && b.uptimePercent === null) return 0;
    if (a.uptimePercent === null) return 1;
    if (b.uptimePercent === null) return -1;
    return a.uptimePercent - b.uptimePercent;
  });

  return NextResponse.json({ windowDays: days, sla, count: sla.length });
}
