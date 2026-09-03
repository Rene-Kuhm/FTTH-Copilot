/**
 * Fase E — thin per-tenant policy loader (chat route + promotion loader).
 *
 * Maps a Prisma `tenant_policies` row to the `TenantPolicy` shape consumed
 * by `runAgent` + `promotePendingIncissions`. Resilient by contract:
 *  - absent row → `null` (Fase C/D byte-identical behavior)
 *  - present row with malformed `abstainOnCodes` JSON → `null` (log + skip)
 *  - present row with one or more unrecognized VerdictCode entries →
 *    the entry is dropped (forward-compat against future enum additions)
 *
 * The helper never throws. The chat route wraps the call site with
 * `Promise.all`; a throw here would break the chat.
 */
import type { TenantPolicy } from '@ftth-copilot/shared';
import type { VerdictCode } from '@ftth-copilot/evidence';
import { prisma } from '@ftth-copilot/db';

export type { TenantPolicy } from '@ftth-copilot/shared';

const TENANT_POLICY_VERSION = 1 as const;
const VERDICT_CODES: ReadonlyArray<VerdictCode> = [
  'ok',
  'low_confidence',
  'stale',
  'incomplete',
];

function isVerdictCode(value: unknown): value is VerdictCode {
  return typeof value === 'string' && (VERDICT_CODES as ReadonlyArray<string>).includes(value);
}

/**
 * Decode the JSON-stored `abstainOnCodes` column. Returns:
 *   - `undefined` when the column is `null` / `undefined` (unset → omit).
 *   - `[]` when the column is a non-empty array of unrecognized entries
 *     (the field is still present so the gate disables for this tenant,
 *     but `null` is NOT returned because the row is otherwise valid).
 *   - `ReadonlyArray<VerdictCode>` with the unrecognized entries dropped.
 *
 * Returns the literal `'__invalid__'` sentinel when the column cannot be
 * decoded as JSON or is not an array — the caller MUST treat this as a
 * malformed row and return `null` for the whole policy.
 */
function decodeAbstainOnCodes(value: unknown): VerdictCode[] | undefined | '__invalid__' {
  if (value === null || value === undefined) return undefined;
  let raw: unknown;
  if (typeof value === 'string') {
    try {
      raw = JSON.parse(value);
    } catch {
      return '__invalid__';
    }
  } else {
    raw = value;
  }
  if (!Array.isArray(raw)) return '__invalid__';
  const filtered = raw.filter(isVerdictCode);
  return filtered.length > 0 ? filtered : [];
}

/**
 * Loads the per-tenant policy envelope for `tenantId`. Returns `null` when:
 *   - no row exists;
 *   - the row is malformed (`abstainOnCodes` JSON parse / shape failure).
 *
 * Field mapping is mechanical: every Prisma column is forwarded verbatim
 * except `abstainOnCodes`, which is decoded from JSON. `schemaVersion` is
 * pinned to `1` (the only schema this build understands); future schema
 * bumps short-circuit to `null` to avoid a silent drift.
 */
export async function loadTenantPolicy(tenantId: string): Promise<TenantPolicy | null> {
  if (!tenantId) return null;
  let row: {
    tenantId: string;
    schemaVersion: number;
    retrievalLimit: number | null;
    retrievalSinceDays: number | null;
    truthGateMode: 'observe' | 'strict' | null;
    abstainOnCodes: unknown;
    promotionMinAgeMs: number | null;
    lastEvaluatedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  } | null;
  try {
    row = await prisma.tenantPolicy.findUnique({ where: { tenantId } });
  } catch (error) {
    console.error('[ftth-copilot/policies] tenantPolicy.findUnique failed', error);
    return null;
  }
  if (!row) return null;
  if (row.schemaVersion !== TENANT_POLICY_VERSION) return null;

  const abstainOnCodes = decodeAbstainOnCodes(row.abstainOnCodes);
  if (abstainOnCodes === '__invalid__') return null;

  return {
    schema: 'ftth.tenant-policy.v1',
    schemaVersion: TENANT_POLICY_VERSION,
    tenantId: row.tenantId,
    ...(row.retrievalLimit !== null ? { retrievalLimit: row.retrievalLimit } : {}),
    ...(row.retrievalSinceDays !== null
      ? { retrievalSinceDays: row.retrievalSinceDays }
      : {}),
    ...(row.truthGateMode !== null ? { truthGateMode: row.truthGateMode } : {}),
    ...(abstainOnCodes !== undefined ? { abstainOnCodes } : {}),
    ...(row.promotionMinAgeMs !== null ? { promotionMinAgeMs: row.promotionMinAgeMs } : {}),
    ...(row.lastEvaluatedAt !== null
      ? { lastEvaluatedAt: row.lastEvaluatedAt.toISOString() }
      : {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}