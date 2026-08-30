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
    select: { deviceKind: true, deviceId: true, valueText: true, sampledAt: true },
  });

  const groups = new Map<
    string,
    { deviceKind: string; deviceId: string; samples: Array<{ t: number; status: 'online' | 'offline' | 'degraded' }> }
  >();

  for (const row of rows) {
    if (row.valueText !== 'online' && row.valueText !== 'offline' && row.valueText !== 'degraded') {
      continue;
    }
    const key = `${row.deviceKind}:${row.deviceId}`;
    let group = groups.get(key);
    if (!group) {
      group = { deviceKind: row.deviceKind, deviceId: row.deviceId, samples: [] };
      groups.set(key, group);
    }
    group.samples.push({ t: row.sampledAt.getTime(), status: row.valueText });
  }

  const sla = [...groups.values()].map((group) => {
    const uptime = computeUptime(group.samples, { from, to });
    return {
      deviceKind: group.deviceKind,
      deviceId: group.deviceId,
      uptimePercent: uptime ? Math.round(uptime.uptimePercent * 100) / 100 : null,
      offlineMs: uptime?.offlineMs ?? null,
    };
  });

  sla.sort((a, b) => (a.uptimePercent ?? 101) - (b.uptimePercent ?? 101));

  return NextResponse.json({ windowDays: days, sla, count: sla.length });
}
