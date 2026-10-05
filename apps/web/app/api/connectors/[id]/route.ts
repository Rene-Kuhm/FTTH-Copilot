import { NextRequest, NextResponse } from 'next/server';
import { deleteConnector } from '@/lib/connectors/server';
import { auditConnector } from '@ftth-copilot/soc';
import { buildAuditContext } from '@/lib/audit-context';
import { getCurrentUser } from '@/lib/auth/server';

export const runtime = 'nodejs';

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  const { id } = await ctx.params;
  const ok = await deleteConnector(id);
  if (!ok) {
    return NextResponse.json({ error: 'Not found or not authorized' }, { status: 404 });
  }

  // Audit log
  await auditConnector.deleted(
    buildAuditContext(req as unknown as import('next/server').NextRequest, user),
    id,
  );

  return NextResponse.json({ ok: true });
}
