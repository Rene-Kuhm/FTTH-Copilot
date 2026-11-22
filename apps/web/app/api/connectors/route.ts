import { listConnectors } from '@/lib/connectors/server';
import { snapshotEvaluatedConnectionHealth } from '@/lib/monitoring/connection-health';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const { user, connectors } = await listConnectors();
  if (!user) {
    return NextResponse.json({ user: null, connectors: [], demoMode: false, health: [] });
  }
  return NextResponse.json({
    user: { id: user.id, email: user.email, tenant: user.tenant },
    connectors,
    demoMode: process.env['DEMO_MODE_ENABLED'] === 'true',
    // Authenticated detail: the registry is scoped to the caller's tenant,
    // so neither ids nor errors from another tenant can leak here.
    health: snapshotEvaluatedConnectionHealth(Date.now(), undefined, undefined, user.tenantId),
  });
}
