/**
 * Phase F-5.1 — verdict-log writer (pure TS).
 *
 * Why this module exists:
 *   The F-1 `verdict_log` Prisma table is the v1 persistence surface for
 *   `AgentResult.verdicts`. The F-3 `finalize` branch populates
 *   `result.warnings: VerdictCode[]` for the warn-tier observability path,
 *   and the F-5 chat route (and the F-4 nightly metrics leg) need a pure
 *   builder that turns a `Verdict[]` into one `VerdictLogEntryInput` row
 *   per verdict, with the `injectionSuspicion` fast-filter bit pre-stamped.
 *
 *   Keeping this module DB-free has three payoffs:
 *     1. The writer is unit-testable in isolation (no Prisma mock needed);
 *     2. The nightly leg (F-4 metrics + F-6 nightly workflow) can call it
 *        from a Node `tsx` script without dragging the Prisma client;
 *     3. The chat-route test surface (which already mocks Prisma) only
 *        has to swap in a single pure function and assert its output.
 *
 * Contract (F-5.1 spec + design.md §File Changes + AD-11):
 *   - `buildVerdictLogEntries(verdicts, opts)` emits ONE entry per verdict.
 *     `tenantId` is required; `messageId` / `conversationId` are
 *     optional (recompute backfill jobs may not have a correlation key).
 *   - `injectionSuspicion` defaults to `true` when
 *     `code ∈ {'stale', 'low_confidence'}` and `false` otherwise (the
 *     denormalized fast-filter bit used to derive the nightly
 *     `injection_suspicion_total` metric). The caller may override the
 *     default per-call by passing `injectionSuspicion` in `opts`.
 *   - `serializeVerdictLogEntries(entries)` returns the JSON string of
 *     the entries array, suitable for storage in the existing
 *     `AgentActionLog.parameters` JSON column as a fallback path when
 *     Prisma is unavailable.
 *
 * NOT exported (intentionally):
 *   - The Prisma client glue. Persistence lives in the chat route (F-5.2)
 *     and the nightly job (F-4 metrics + F-6 nightly workflow). The
 *     writer is the pure bridge between `runAgent.verdicts` and the
 *     table rows.
 */
import type { Verdict, VerdictCode, VerdictSeverity } from '@ftth-copilot/evidence';

/**
 * Shape of a single `verdict_log` row as the writer emits it.
 *
 * The shape intentionally omits `id` (Prisma default `cuuid()`) and the
 * `schema` literal (the wire-contract surface — see
 * `verdictLogSchema` (`ftth.verdict-log.v1`) in `@ftth-copilot/shared`).
 * Prisma's `verdictLog.create` / `createMany` accepts the input
 * directly; the schema literal lives at retrieval time and is not
 * stored in the database row.
 *
 * Field mapping to `VerdictLog` Prisma model:
 *   - `tenantId`            → `tenantId` (non-null, required)
 *   - `messageId?`          → `messageId` (non-null; optional here so
 *                             recompute backfill jobs may pass `undefined`)
 *   - `conversationId?`     → `conversationId` (nullable in DB; soft ref)
 *   - `toolName`            → `toolName` (non-null, required)
 *   - `code`                → `code` (`VerdictCode` enum at the DB)
 *   - `severity`            → `severity` (`VerdictSeverity` enum at the DB)
 *   - `observedAt?`         → `observedAt` (DB default = `now()`)
 *   - `injectionSuspicion?` → `injectionSuspicion` (DB default = `false`)
 */
export interface VerdictLogEntryInput {
  tenantId: string;
  messageId?: string;
  conversationId?: string;
  toolName: string;
  code: VerdictCode;
  severity: VerdictSeverity;
  observedAt?: string;
  injectionSuspicion?: boolean;
}

/**
 * Options accepted by `buildVerdictLogEntries`. The correlation keys
 * (`messageId`, `conversationId`) and the timestamps
 * (`observedAt`, `injectionSuspicion`) are all optional to keep the
 * writer callable from contexts that may not have a chat-message
 * correlation (recompute / backfill / nightly metrics).
 */
export interface BuildVerdictLogEntriesOpts {
  tenantId: string;
  messageId?: string;
  conversationId?: string;
  /**
   * Optional explicit override for the `injectionSuspicion` bit. When
   * `undefined` the writer derives the value from the verdict's `code`
   * (see `INJECTION_SUSPICION_CODES`).
   */
  injectionSuspicion?: boolean;
  /**
   * Optional explicit override for the `observedAt` ISO datetime. When
   * `undefined` the writer omits the field, allowing Prisma's
   * `@default(now())` to stamp it at write time.
   */
  observedAt?: string;
}

/**
 * Verdict codes that flag the originating run as a possible injection
 * attempt. Per design.md §Architecture Decisions #11 the `verdict_log`
 * `injectionSuspicion` denormalized bit is derived from this set so
 * the nightly `injection_suspicion_total` metric can run as a simple
 * index scan without a JSON cast.
 */
const INJECTION_SUSPICION_CODES: ReadonlySet<VerdictCode> = new Set<VerdictCode>([
  'stale',
  'low_confidence',
]);

/**
 * Derives the `injectionSuspicion` default from a verdict code. Pure
 * function — exported (via `index.ts`) for the F-4 nightly metrics
 * leg so a recompute job over historical rows can re-stamp the bit
 * without duplicating the constant.
 */
export function isInjectionSuspicionCode(code: VerdictCode): boolean {
  return INJECTION_SUSPICION_CODES.has(code);
}

/**
 * Builds one `VerdictLogEntryInput` row per verdict.
 *
 * Determinism: insertion-order iteration over the input `verdicts` array
 * (no sort, no dedup). Two verdicts with the same `toolName` therefore
 * produce two rows — the F-1 spec defines one row per (message, tool-call
 * verdict) and explicitly forbids collapse.
 *
 * Empty `verdicts` → `[]` (no synthetic "no-op" rows). The F-5.2 chat
 * route is responsible for skipping the `prisma.verdictLog.createMany`
 * call entirely when the array is empty.
 */
export function buildVerdictLogEntries(
  verdicts: ReadonlyArray<Verdict>,
  opts: BuildVerdictLogEntriesOpts,
): VerdictLogEntryInput[] {
  if (verdicts.length === 0) return [];
  const entries: VerdictLogEntryInput[] = [];
  for (const verdict of verdicts) {
    const injectionSuspicion =
      opts.injectionSuspicion ?? isInjectionSuspicionCode(verdict.code);
    const entry: VerdictLogEntryInput = {
      tenantId: opts.tenantId,
      toolName: verdict.toolName,
      code: verdict.code,
      severity: verdict.severity,
      ...(opts.messageId !== undefined ? { messageId: opts.messageId } : {}),
      ...(opts.conversationId !== undefined
        ? { conversationId: opts.conversationId }
        : {}),
      ...(opts.observedAt !== undefined ? { observedAt: opts.observedAt } : {}),
      ...(injectionSuspicion !== undefined ? { injectionSuspicion } : {}),
    };
    entries.push(entry);
  }
  return entries;
}

/**
 * JSON-serializes the entries array. Used as the fallback path when the
 * `prisma.verdictLog.createMany` call is unavailable — the resulting
 * string drops into the existing `AgentActionLog.parameters` JSON column
 * unchanged.
 *
 * Notes:
 *   - `JSON.stringify` with `JSON.parse` round-trip is the documented
 *     contract. No replacer / reviver — the entries are plain data.
 *   - Empty array → the literal `'[]'` string (not `'undefined'` /
 *     `'null'`); callers can `JSON.parse` the result unconditionally.
 *   - The function is intentionally NOT zod-validated at this layer.
 *     The wire validation happens at the chat-route boundary
 *     (`prisma.verdictLog.create` enforces the Prisma column types;
 *     the F-1 `verdictLogSchema` is the external wire contract for
 *     read paths). Re-validating on every write would duplicate the
 *     type system without adding safety.
 */
export function serializeVerdictLogEntries(entries: ReadonlyArray<VerdictLogEntryInput>): string {
  return JSON.stringify(entries);
}
