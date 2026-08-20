import { NextResponse } from 'next/server';
import { SmartOltClient } from '@ftth-copilot/connectors-smartolt';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const client = new SmartOltClient({ useMock: true });

  const [overview, olts, onus] = await Promise.all([
    client.getNetworkOverview(),
    client.listOlts(),
    client.listOnus(),
  ]);

  // Compute per-OLT stats
  const oltsWithStats = olts.map(olt => {
    const oltOnus = onus.filter(o => o.oltId === olt.id);
    return {
      ...olt,
      onusTotal: oltOnus.length,
      onusOnline: oltOnus.filter(o => o.status === 'online').length,
      onusOffline: oltOnus.filter(o => o.status === 'offline').length,
      onusDegraded: oltOnus.filter(o => o.status === 'degraded').length,
    };
  });

  return NextResponse.json({
    overview,
    olts: oltsWithStats,
    statusDistribution: {
      online: onus.filter(o => o.status === 'online').length,
      offline: onus.filter(o => o.status === 'offline').length,
      degraded: onus.filter(o => o.status === 'degraded').length,
    },
  });
}
