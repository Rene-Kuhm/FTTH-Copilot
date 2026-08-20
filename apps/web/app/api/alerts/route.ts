import { NextResponse } from 'next/server';
import { SmartOltClient } from '@ftth-copilot/connectors-smartolt';
import { detectAlerts } from '@ftth-copilot/agent-core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const client = new SmartOltClient({ useMock: true });
  const alerts = await detectAlerts(client);
  return NextResponse.json({ alerts, count: alerts.length });
}
