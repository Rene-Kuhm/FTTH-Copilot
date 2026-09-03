import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/server';
import { promotePendingIncidents } from '@/lib/promote-pending-incidents';

/**
 * POST /api/pending-incidents/promote — admin promotion path for Fase D.
 *
 * OWNER-only (no `manage_*` permission in Phase D — the gate is a hard role
 * check because the promotion writes a `ConfirmedIncident` row that the
 * retrieval path will surface to the LLM as background context). Delegates
 * the eligibility + persistence to `promotePendingIncidents(now)`.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: Request): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (user.role !== 'OWNER') {
    return NextResponse.json(
      { error: 'Solo OWNER puede promover incidentes confirmados por el agente.' },
      { status: 403 },
    );
  }

  const result = await promotePendingIncidents(new Date());
  return NextResponse.json(result, { status: 200 });
}