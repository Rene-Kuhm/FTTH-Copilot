import { listConnectors } from '@/lib/connectors/server';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const { user, connectors } = await listConnectors();
  if (!user) {
    return NextResponse.json({ user: null, connectors: [], demoMode: false });
  }
  return NextResponse.json({
    user: { id: user.id, email: user.email, tenant: user.tenant },
    connectors,
    demoMode: process.env['DEMO_MODE_ENABLED'] === 'true',
  });
}
