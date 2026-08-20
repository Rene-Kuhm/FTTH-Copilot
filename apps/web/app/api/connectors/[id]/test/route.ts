import { NextResponse } from 'next/server';
import { prisma, decryptApiKey } from '@ftth-copilot/db';
import { getCurrentUser } from '@/lib/auth/server';
import { SmartOltClient } from '@ftth-copilot/connectors-smartolt';

export const runtime = 'nodejs';

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const conn = await prisma.nmsConnection.findFirst({
    where: { id, tenantId: user.tenantId },
  });
  if (!conn) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  let client;
  if (conn.provider === 'SMARTOLT') {
    const apiKey = decryptApiKey(conn.encryptedKey, conn.encryptionMeta);
    client = new SmartOltClient({
      useMock: false,
      apiKey,
      apiBaseUrl: conn.baseUrl ?? undefined,
    });
  } else {
    return NextResponse.json({
      ok: false,
      error: 'Real adapter for ' + conn.provider + ' not yet implemented',
    });
  }

  const result = await client.ping();
  await prisma.nmsConnection.update({
    where: { id },
    data: {
      status: result.ok ? 'connected' : 'error',
      lastCheckedAt: new Date(),
      lastError: result.ok ? null : ((result.error as string | undefined) ?? '').slice(0, 500),
    },
  });

  return NextResponse.json(result);
}
