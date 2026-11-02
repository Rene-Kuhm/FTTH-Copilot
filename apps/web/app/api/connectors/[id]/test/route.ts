import { createLogger, correlationIdFrom } from '@ftth-copilot/shared';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@ftth-copilot/db';
import { getCurrentUser } from '@/lib/auth/server';
import { hasPermission } from '@/lib/auth/permissions';
import {
  buildConnectorFromConnection,
  ConnectorResolutionError,
} from '@/lib/connectors/chat-client';
import { auditConnector } from '@ftth-copilot/soc';
import { buildAuditContext } from '@/lib/audit-context';
import { enforceApiRateLimit } from '@/lib/rate-limit-store';

const log = createLogger({ name: 'connector-test' });

export const runtime = 'nodejs';

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const requestLog = log.child({ correlationId: correlationIdFrom(req.headers) });
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const limited = await enforceApiRateLimit(req, user.tenantId);
  if (limited) return limited;
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
    requestLog.error('Connector error', { tenantId: user.tenantId, error });
  }

  await prisma.nmsConnection.update({
    where: { id },
    data: {
      status: result.ok ? 'connected' : 'error',
      lastCheckedAt: new Date(),
      lastError: result.ok ? null : (result.error ?? '').slice(0, 500),
    },
  });

  // Audit log for connector test
  await auditConnector.tested(
    buildAuditContext(req as unknown as import('next/server').NextRequest, user),
    id,
    result.ok,
  );

  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
