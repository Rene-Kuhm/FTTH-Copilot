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

/**
 * Fase E — minimal slice of `TenantPolicy` consulted by
 * `retrieveRelevantIncidents`. Defined structurally so the evidence
 * package never pulls the Prisma row through its import graph.
 */
export interface RetrievalTenantPolicy {
  readonly retrievalLimit?: number;
  readonly retrievalSinceDays?: number;
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
 *
 * Fase E — trailing optional `tenantPolicy`. Resolution precedence for both
 * `limit` and `sinceDays` is `args.X ?? tenantPolicy.X ?? moduleDefault.X`.
 * Absent `tenantPolicy` → Fase D byte-identical.
 */
export function retrieveRelevantIncidents(
  args: RetrieveRelevantIncidentsArgs,
  tenantPolicy?: RetrievalTenantPolicy,
): RelevantIncidentResult[] {
  if (!args.tenantId) throw new MissingTenantError();
  if ((args.mode ?? 'live') !== 'live') return [];
  if (args.confirmedIncidents.length === 0) return [];

  const now = args.now ?? new Date();
  const limit = args.limit ?? tenantPolicy?.retrievalLimit ?? DEFAULT_LIMIT;
  const sinceDays = args.sinceDays ?? tenantPolicy?.retrievalSinceDays ?? DEFAULT_SINCE_DAYS;
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
    .slice(0, limit);
}

// ── Spanish rioplatense presentation layer (snapshot-locked) ────────────────
//
// Same template-locking discipline as `formatIdentifierNextStep`
// (`abstention-policy.ts`): the literal lives in one exported constant so the
// snapshot test is the regression net for any prompt drift. The heading is
// what keeps retrieved history OUT of the evidence frame — it tells the model
// explicitly that these rows are context, not measurements.

export const RELEVANT_INCIDENTS_HEADING =
  '## Incidentes previos relevantes (contexto, no evidencia)\n\n' +
  '(Estos son contexto de la historia del ISP; no los cites como evidencia de la medición actual.)\n\n';

/** Deterministic UTC `YYYY-MM-DD`; never locale-dependent. */
function formatDay(isoDatetime: string): string {
  return new Date(isoDatetime).toISOString().slice(0, 10);
}

/**
 * Renders the pre-LLM context block. Returns `''` for an empty list so the
 * caller can concatenate unconditionally and still guarantee that the
 * heading never appears without incidents behind it.
 *
 * Line format (design-locked, 1-indexed):
 * `[N] YYYY-MM-DD — {deviceId} {summary}. Causa raíz: {rootCause}. Fix: {fix}. Score: {n.nn}\n`
 */
export function formatRelevantIncidentsBlock(incidents: RelevantIncidentResult[]): string {
  if (incidents.length === 0) return '';
  const lines = incidents.map(
    (row, i) =>
      `[${i + 1}] ${formatDay(row.observedAt)} — ${row.deviceId} ${row.summary}. ` +
      `Causa raíz: ${row.rootCause}. Fix: ${row.fix}. Score: ${row.score.toFixed(2)}\n`,
  );
  return RELEVANT_INCIDENTS_HEADING + lines.join('');
}
