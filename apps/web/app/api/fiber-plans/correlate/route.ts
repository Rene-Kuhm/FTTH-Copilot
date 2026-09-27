/**
 * GET /api/fiber-plans/correlate?deviceKind=&deviceId=
 *
 * Given a deviceKind + deviceId, find all plan markers that reference it
 * and return the associated plan(s) and zone(s).
 * This enables the "Ver plano" button in IncidentsPanel.
 */
import { NextResponse } from 'next/server';
import { prisma } from '@ftth-copilot/db';
import { getCurrentUser } from '@/lib/auth/server';
import { hasPermission } from '@/lib/auth/permissions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_DEVICE_KINDS = ['OLT', 'PON_PORT', 'SPLITTER', 'CTO', 'ONU'] as const;

/** GET /api/fiber-plans/correlate */
export async function GET(request: Request): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!hasPermission(user.role, 'view_network')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const url = new URL(request.url);
  const deviceKind = url.searchParams.get('deviceKind');
  const deviceId = url.searchParams.get('deviceId');

  if (!deviceKind || !deviceId) {
    return NextResponse.json(
      { error: 'Missing required query params: deviceKind, deviceId' },
      { status: 400 },
    );
  }

  if (!VALID_DEVICE_KINDS.includes(deviceKind as typeof VALID_DEVICE_KINDS[number])) {
    return NextResponse.json(
      { error: `Invalid deviceKind. Must be one of: ${VALID_DEVICE_KINDS.join(', ')}` },
      { status: 400 },
    );
  }

  // Find all markers for this device in the tenant
  const markers = await prisma.planMarker.findMany({
    where: {
      tenantId: user.tenantId,
      deviceKind,
      deviceId,
    },
    select: {
      id: true,
      label: true,
      deviceKind: true,
      deviceId: true,
      xPercent: true,
      yPercent: true,
      zone: {
        select: {
          id: true,
          name: true,
          color: true,
          plan: {
            select: {
              id: true,
              name: true,
              fileUrl: true,
              mimeType: true,
            },
          },
        },
      },
    },
  });

  // Group by plan
  const planMap = new Map<
    string,
    {
      plan: { id: string; name: string; fileUrl: string; mimeType: string };
      markers: Array<{
        id: string;
        label: string;
        xPercent: number;
        yPercent: number;
        zone: { id: string; name: string; color: string } | null;
      }>;
    }
  >();

  for (const marker of markers) {
    const plan = marker.zone?.plan;
    if (!plan) continue; // unzoned markers don't link to a specific plan in this query

    if (!planMap.has(plan.id)) {
      planMap.set(plan.id, { plan, markers: [] });
    }
    planMap.get(plan.id)!.markers.push({
      id: marker.id,
      label: marker.label,
      xPercent: marker.xPercent,
      yPercent: marker.yPercent,
      zone: marker.zone ? { id: marker.zone.id, name: marker.zone.name, color: marker.zone.color } : null,
    });
  }

  const results = Array.from(planMap.values()).map(({ plan, markers }) => ({
    plan,
    markers,
    markerCount: markers.length,
    primaryZone: markers[0]?.zone ?? null,
  }));

  return NextResponse.json({
    deviceKind,
    deviceId,
    plans: results,
    totalPlans: results.length,
  });
}
