import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/server';
import { promotePendingIncidents } from '@/lib/promote-pending-incidents';
import { loadTenantPolicy } from '@/lib/policies/load-tenant-policy';
import { prisma } from '@ftth-copilot/db';
import type { TenantPolicy } from '@ftth-copilot/shared';

/**
 * POST /api/pending-incidents/promote — admin promotion path for Fase D.
 *
 * OWNER-only (no `manage_*` permission in Phase D — the gate is a hard role
 * check because the promotion writes a `ConfirmedIncident` row that the
 * retrieval path will surface to the LLM as background context). Delegates
 * the eligibility + persistence to `promotePendingIncidents(now,
 * policyLoader)`.
 *
 * Fase E — the `policyLoader` issues a single batched
 * `prisma.tenantPolicy.findMany({where: {tenantId: {in: tenantIds}}})`
 * query and groups the rows in a `Map<tenantId, TenantPolicy>`. Per-
 * candidate lookup is O(1); there is no N+1 on the policy read path.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const loadPoliciesForPromotion = async (
  tenantIds: ReadonlyArray<string>,
): Promise<Map<string, TenantPolicy>> => {
  if (tenantIds.length === 0) return new Map();
  const rows = await prisma.tenantPolicy.findMany({
    where: { tenantId: { in: [...tenantIds] } },
  });
  const map = new Map<string, TenantPolicy>();
  for (const row of rows) {
    const policy = await loadTenantPolicy(row.tenantId);
    if (policy) map.set(row.tenantId, policy);
  }
  return map;
};

export async function POST(_req: Request): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (user.role !== 'OWNER') {
    return NextResponse.json(
      { error: 'Solo OWNER puede promover incidentes confirmados por el agente.' },
      { status: 403 },
    );
  }

  const result = await promotePendingIncidents(new Date(), loadPoliciesForPromotion);
  return NextResponse.json(result, { status: 200 });
}