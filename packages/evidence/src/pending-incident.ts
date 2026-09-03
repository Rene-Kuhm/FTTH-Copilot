/**
 * Pending incident candidates — Fase D agent-confirmation path (pure TS).
 *
 * The chat route writes one candidate per clean live run; an admin route
 * later promotes eligible candidates into `ConfirmedIncident` rows. Both
 * the draft constructor and the promotion gate live here as pure functions
 * so the gating rules are testable without Prisma, and so the route stays a
 * thin persistence shell.
 */
import {
  PENDING_INCIDENT_CANDIDATE_SCHEMA,
  type PendingIncidentCandidate,
} from '@ftth-copilot/shared';

/** A source incident must stay resolved for this long before promotion. */
export const PROMOTION_MIN_AGE_MS = 24 * 3_600_000;

export interface BuildPendingIncidentCandidateArgs {
  tenantId: string;
  summary: string;
  toolCallsJson: unknown;
  sourceIncidentId?: string;
  runSessionId?: string;
  now?: Date;
}

/**
 * Builds the pre-insert candidate draft. `id` is intentionally `''`: the
 * database generates it on insert, so the draft is not yet a valid
 * `pendingIncidentCandidateSchema` payload (which requires a non-empty id).
 * Validate after the write, not before.
 */
export function buildPendingIncidentCandidate(
  args: BuildPendingIncidentCandidateArgs,
): PendingIncidentCandidate {
  if (!args.tenantId) {
    throw new Error('buildPendingIncidentCandidate requires a non-empty tenantId');
  }
  if (!args.summary) {
    throw new Error('buildPendingIncidentCandidate requires a non-empty summary');
  }

  const stamp = (args.now ?? new Date()).toISOString();
  return {
    schema: PENDING_INCIDENT_CANDIDATE_SCHEMA,
    id: '',
    tenantId: args.tenantId,
    sourceIncidentId: args.sourceIncidentId,
    runSessionId: args.runSessionId,
    summary: args.summary,
    toolCallsJson: args.toolCallsJson,
    proposedConfirmedAt: stamp,
    status: 'pending',
    createdAt: stamp,
  };
}

/**
 * Promotion gate. All four conditions must hold:
 *  - the candidate is still `pending` (never re-promote);
 *  - the source incident is `resolved`;
 *  - it has stayed resolved for at least the resolved promotionMinAgeMs
 *    (a future `resolvedAt` therefore fails, which is the clock-skew guard);
 *  - the originating run produced no `incomplete` verdict.
 *
 * Fase E — trailing optional `tenantPolicy`. The minimum-age threshold
 * resolves as `tenantPolicy.promotionMinAgeMs ?? PROMOTION_MIN_AGE_MS`
 * (Fase D archive §1 pre-approved this shape). Absent `tenantPolicy` →
 * Fase D byte-identical (24h baseline).
 */
export interface PromotionTenantPolicy {
  readonly promotionMinAgeMs?: number;
}

export function eligibleForPromotion(
  candidate: PendingIncidentCandidate,
  sourceIncident: { status: string; resolvedAt: Date },
  now: Date,
  hasIncompleteVerdict: boolean,
  tenantPolicy?: PromotionTenantPolicy,
): boolean {
  if (candidate.status !== 'pending') return false;
  if (sourceIncident.status !== 'resolved') return false;
  if (hasIncompleteVerdict) return false;
  const minAge = tenantPolicy?.promotionMinAgeMs ?? PROMOTION_MIN_AGE_MS;
  return now.getTime() - sourceIncident.resolvedAt.getTime() >= minAge;
}
