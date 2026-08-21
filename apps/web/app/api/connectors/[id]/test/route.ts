import { NextResponse } from 'next/server';
import { prisma } from '@ftth-copilot/db';
import { getCurrentUser } from '@/lib/auth/server';
import { hasPermission } from '@/lib/auth/permissions';
import {
  buildConnectorFromConnection,
  ConnectorResolutionError,
} from '@/lib/connectors/chat-client';

export const runtime = 'nodejs';

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!hasPermission(user.role, 'manage_connectors')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const connection = await prisma.nmsConnection.findFirst({
    where: { id, tenantId: user.tenantId },
  });
  if (!connection) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let result: { ok: boolean; latencyMs?: number; error?: string };
  try {
    const resolved = buildConnectorFromConnection(connection);
    result = await resolved.connector.ping();
  } catch (error) {
    result = {
      ok: false,
      error: error instanceof ConnectorResolutionError
        ? error.message
        : 'No se pudo conectar con el NMS.',
    };
    console.error('[ftth-copilot/api/connectors/test] connector error', error);
  }

  await prisma.nmsConnection.update({
    where: { id },
    data: {
      status: result.ok ? 'connected' : 'error',
      lastCheckedAt: new Date(),
      lastError: result.ok ? null : (result.error ?? '').slice(0, 500),
    },
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
