/**
 * Fase D WU5 — Admin promotion helper for PendingIncidentCandidate → ConfirmedIncident.
 *
 * Owns the DB read/write flow for promoting agent-confirmed candidates that
 * have aged past the 24h grace period. Pure eligibility logic lives in
 * `@ftth-copilot/evidence` (`eligibleForPromotion`); this module only
 * orchestrates the persistence shell so the admin route stays thin.
 *
 * Fase E — optional `policyLoader` argument. The route passes
 * `loadTenantPolicy` so each candidate can consult its tenant's
 * `promotionMinAgeMs` override without an N+1 DB round-trip. The loader
 * is called AT MOST once (batched `findMany` → `Map<tenantId, TenantPolicy>`).
 */
import { prisma } from '@ftth-copilot/db';
import { PROMOTION_MIN_AGE_MS, eligibleForPromotion } from '@ftth-copilot/evidence';
import type { TenantPolicy } from '@ftth-copilot/shared';

export interface PromotePendingIncidentsResult {
  promoted: number;
  skipped: number;
}

export type PolicyLoader = (
  tenantIds: ReadonlyArray<string>,
) => Promise<Map<string, TenantPolicy>>;

function hasIncompleteVerdict(toolCallsJson: unknown): boolean {
  if (!Array.isArray(toolCallsJson)) return false;
  return toolCallsJson.some(
    (entry) =>
      typeof entry === 'object' &&
      entry !== null &&
      (entry as { code?: unknown }).code === 'incomplete',
  );
}

function toCandidateShape(candidate: {
  id: string;
  tenantId: string;
  sourceIncidentId: string | null;
  runSessionId: string | null;
  summary: string;
  toolCallsJson: unknown;
  proposedConfirmedAt: Date;
  status: string;
}) {
  return {
    schema: 'ftth.pending-incident-candidate.v1' as const,
    id: candidate.id,
    tenantId: candidate.tenantId,
    sourceIncidentId: candidate.sourceIncidentId ?? undefined,
    runSessionId: candidate.runSessionId ?? undefined,
    summary: candidate.summary,
    toolCallsJson: candidate.toolCallsJson,
    proposedConfirmedAt: candidate.proposedConfirmedAt.toISOString(),
    status: candidate.status as 'pending' | 'promoted' | 'rejected',
  };
}

/**
 * Promotes every eligible PendingIncidentCandidate and returns the per-call
 * counters. Idempotent: candidates that have already been promoted (or that
 * the join drops on this call) are counted as `skipped` and produce zero
 * new rows.
 *
 * `now` is injected so the test can lock the 24h boundary deterministically;
 * callers that want the system clock can simply omit it.
 *
 * `policyLoader` is optional. When present, the helper batches a single
 * `loadTenantPolicy` call (covering every distinct `tenantId` in the
 * candidate set) and looks up each candidate's per-tenant
 * `promotionMinAgeMs` from the resulting `Map` in O(1). Absent loader or
 * absent row → Fase D 24h baseline.
 */
export async function promotePendingIncidents(
  now: Date = new Date(),
  policyLoader?: PolicyLoader,
): Promise<PromotePendingIncidentsResult> {
  const candidates = await prisma.pendingIncidentCandidate.findMany({
    where: { status: 'pending' },
  });
  if (candidates.length === 0) return { promoted: 0, skipped: 0 };

  const tenantIds = Array.from(new Set(candidates.map((c) => c.tenantId)));
  const incidents = await prisma.incident.findMany({
    where: { tenantId: { in: tenantIds } },
  });
  const incidentById = new Map(incidents.map((i) => [i.id, i]));

  // Fase E — single batched tenantPolicy lookup. The route passes
  // `loadTenantPolicy`; tests pass a stub to assert N+1 avoidance.
  const policyByTenantId: Map<string, TenantPolicy> = policyLoader
    ? await policyLoader(tenantIds)
    : new Map();

  let promoted = 0;
  let skipped = 0;
  for (const candidate of candidates) {
    // sourceIncidentId is a soft reference (incidents stay deletable). When
    // it is missing or the row no longer exists, we mark the candidate as
    // `rejected` so the next call doesn't pick it up again.
    if (!candidate.sourceIncidentId || !incidentById.has(candidate.sourceIncidentId)) {
      await prisma.pendingIncidentCandidate.update({
        where: { id: candidate.id },
        data: { status: 'rejected' },
      });
      skipped += 1;
      continue;
    }
    const sourceIncident = incidentById.get(candidate.sourceIncidentId);
    if (!sourceIncident) {
      skipped += 1;
      continue;
    }
    const hasIncomplete = hasIncompleteVerdict(candidate.toolCallsJson);
    // `eligibleForPromotion` requires a non-null `resolvedAt`; the
    // status==='resolved' predicate already implies it, but the Prisma
    // schema models the column as nullable, so narrow it for the type system.
    if (!sourceIncident.resolvedAt) {
      skipped += 1;
      continue;
    }
    const tenantPolicy = policyByTenantId.get(candidate.tenantId);
    const eligible = eligibleForPromotion(
      toCandidateShape(candidate),
      { status: sourceIncident.status, resolvedAt: sourceIncident.resolvedAt },
      now,
      hasIncomplete,
      tenantPolicy ? { promotionMinAgeMs: tenantPolicy.promotionMinAgeMs } : undefined,
    );
    if (!eligible) {
      skipped += 1;
      continue;
    }

    const observedAt = sourceIncident.resolvedAt ?? candidate.proposedConfirmedAt;
    const resolvedAt = sourceIncident.resolvedAt ?? candidate.proposedConfirmedAt;
    const searchTokens = candidate.summary
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 0)
      .join(' ');

    const created = await prisma.confirmedIncident.create({
      data: {
        tenantId: candidate.tenantId,
        deviceKind: sourceIncident.deviceKind,
        deviceId: sourceIncident.deviceId,
        sourceIncidentId: candidate.sourceIncidentId,
        sourceTool: '__agent_promote__',
        summary: candidate.summary,
        symptoms: {} as object,
        rootCause: candidate.summary,
        fix: 'Promovido desde el run del agente.',
        observedAt,
        resolvedAt,
        confirmedBy: 'agent',
        searchTokens,
      },
    });

    await prisma.agentActionLog.create({
      data: {
        tenantId: candidate.tenantId,
        toolName: '__agent_promote__',
        parameters: {
          candidateId: candidate.id,
          sourceIncidentId: candidate.sourceIncidentId,
        },
        result: created.id,
        durationMs: 0,
      },
    });

    await prisma.pendingIncidentCandidate.update({
      where: { id: candidate.id },
      data: { status: 'promoted' },
    });

    promoted += 1;
  }
  return { promoted, skipped };
}

export { PROMOTION_MIN_AGE_MS };