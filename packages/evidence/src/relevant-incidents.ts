/**
 * Confirmed-incident retrieval — Fase D sparse-first RAG (pure TypeScript).
 *
 * `retrieveRelevantIncidents` is a pure ranking function over an already
 * tenant-loaded candidate array: the caller (the chat route, WU3) owns the
 * Prisma read and the connector readiness check, this module owns refusal,
 * isolation, windowing, scoring, and the demo/live parity guarantee.
 *
 * Retrieved rows are BACKGROUND CONTEXT, never evidence: they never enter
 * the Truth Gate data path (`evidence.provenance.v1`, `shouldAbstain`), and
 * `formatRelevantIncidentsBlock` renders them under an explicit
 * "contexto, no evidencia" heading.
 */
import type { ConfirmedIncident, RelevantIncidentResult } from '@ftth-copilot/shared';
import { scoreCorpus, tokenize } from './bm25-lite';

/** Reciprocal-rank-fusion constant. Phase 2 merges a dense list with the same K. */
export const RRF_K = 60 as const;

/** Minimum sparse (BM25) score a candidate needs to stay in the result set. */
export const MIN_SPARSESCORE = 0.05;

/** Default top-K. */
export const DEFAULT_LIMIT = 5;

/** Default recall window in days. */
export const DEFAULT_SINCE_DAYS = 90;

/** Multiplier applied to the sparse score when `deviceHint` matches the row. */
export const DEVICE_HINT_BOOST = 1.5;

const DAY_MS = 86_400_000;

/** Thrown when a caller reaches retrieval without a tenant scope. */
export class MissingTenantError extends Error {
  constructor(message = 'retrieveRelevantIncidents requires a non-empty tenantId') {
    super(message);
    this.name = 'MissingTenantError';
  }
}

export type DeviceHint = string | { deviceKind: 'OLT' | 'ONU'; deviceId: string };

export interface RetrieveRelevantIncidentsArgs {
  tenantId: string;
  query: string;
  deviceHint?: DeviceHint;
  limit?: number;
  sinceDays?: number;
  mode?: 'live' | 'demo';
  now?: Date;
  confirmedIncidents: ConfirmedIncident[];
}

function matchesHint(row: ConfirmedIncident, hint: DeviceHint | undefined): boolean {
  if (hint === undefined) return false;
  if (typeof hint === 'string') return hint === row.deviceId;
  return hint.deviceId === row.deviceId && hint.deviceKind === row.deviceKind;
}

/**
 * Ranks prior confirmed incidents against the operator query.
 *
 * Order of operations (each step is spec-mandated):
 *  1. refuse without a tenant (`MissingTenantError`);
 *  2. short-circuit to `[]` outside live mode (demo == live parity: demo
 *     never sees tenant history);
 *  3. scope to `tenantId` and to the `sinceDays` window on `resolvedAt`;
 *  4. BM25 over the pre-computed `searchTokens`, boosted by `deviceHint`;
 *  5. drop candidates below `MIN_SPARSESCORE` (kills zero-overlap rows);
 *  6. RRF over the surviving sparse ranking, capped at `limit`.
 *
 * Deviation from `design.md`, recorded deliberately: the design writes the
 * final score as the raw `Σ 1 / (RRF_K + rank)`. With `RRF_K = 60` the best
 * possible raw value is `1/61 ≈ 0.0164`, which is below `MIN_SPARSESCORE`,
 * so the design's own threshold rule would return `[]` for every input. We
 * normalize by `(RRF_K + 1)`: the ordering is byte-identical to raw RRF, the
 * top rank scores `1.0`, and the score stays inside the `[0, 1]` range that
 * `confirmedIncidentSchema.score` requires. `MIN_SPARSESCORE` is enforced on
 * the sparse side, where it is the meaningful filter.
 */
export function retrieveRelevantIncidents(
  args: RetrieveRelevantIncidentsArgs,
): RelevantIncidentResult[] {
  if (!args.tenantId) throw new MissingTenantError();
  if ((args.mode ?? 'live') !== 'live') return [];
  if (args.confirmedIncidents.length === 0) return [];

  const now = args.now ?? new Date();
  const sinceDays = args.sinceDays ?? DEFAULT_SINCE_DAYS;
  const cutoff = now.getTime() - sinceDays * DAY_MS;

  const candidates = args.confirmedIncidents.filter(
    (row) => row.tenantId === args.tenantId && Date.parse(row.resolvedAt) >= cutoff,
  );
  if (candidates.length === 0) return [];

  const queryTokens = tokenize(args.query);
  const sparse = scoreCorpus(
    queryTokens,
    candidates.map((row) => ({ tokens: tokenize(row.searchTokens) })),
  );

  const ranked = candidates
    .map((row, i) => ({
      row,
      sparseScore: sparse[i]! * (matchesHint(row, args.deviceHint) ? DEVICE_HINT_BOOST : 1),
    }))
    .filter((entry) => entry.sparseScore >= MIN_SPARSESCORE)
    .sort((a, b) => b.sparseScore - a.sparseScore);

  return ranked
    .map((entry, index) => ({
      ...entry.row,
      score: (RRF_K + 1) / (RRF_K + index + 1),
    }))
    .filter((entry) => entry.score >= MIN_SPARSESCORE)
    .slice(0, args.limit ?? DEFAULT_LIMIT);
}
