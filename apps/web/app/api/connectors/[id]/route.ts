import { deleteConnector } from '@/lib/connectors/server';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;
  const ok = await deleteConnector(id);
  if (!ok) {
    return NextResponse.json({ error: 'Not found or not authorized' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
