import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/server';
import { hasPermission } from '@/lib/auth/permissions';
import {
  ConnectorResolutionError,
  resolveTenantConnector,
} from '@/lib/connectors/chat-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!hasPermission(user.role, 'view_network')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const connectionId = req.nextUrl.searchParams.get('connectionId');
  let resolved;
  try {
    resolved = await resolveTenantConnector({ tenantId: user.tenantId, connectionId });
  } catch (error) {
    if (error instanceof ConnectorResolutionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  const [overview, olts, onus] = await Promise.all([
    resolved.connector.getNetworkOverview(),
    resolved.connector.listOlts(),
    resolved.connector.listOnus(),
  ]);

  const oltsWithStats = olts.map((olt) => {
    const oltOnus = onus.filter((onu) => onu.oltId === olt.id);
    return {
      ...olt,
      onusTotal: oltOnus.length,
      onusOnline: oltOnus.filter((onu) => onu.status === 'online').length,
      onusOffline: oltOnus.filter((onu) => onu.status === 'offline').length,
      onusDegraded: oltOnus.filter((onu) => onu.status === 'degraded').length,
    };
  });

  return NextResponse.json({
    dataSource: resolved.dataSource,
    overview,
    olts: oltsWithStats,
    statusDistribution: {
      online: onus.filter((onu) => onu.status === 'online').length,
      offline: onus.filter((onu) => onu.status === 'offline').length,
      degraded: onus.filter((onu) => onu.status === 'degraded').length,
    },
  });
}
