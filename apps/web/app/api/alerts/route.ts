import { NextRequest, NextResponse } from 'next/server';
import { detectAlerts } from '@ftth-copilot/agent-core';
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
  try {
    const resolved = await resolveTenantConnector({ tenantId: user.tenantId, connectionId });
    const alerts = await detectAlerts(resolved.connector);
    return NextResponse.json({
      alerts,
      count: alerts.length,
      dataSource: resolved.dataSource,
    });
  } catch (error) {
    if (error instanceof ConnectorResolutionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
