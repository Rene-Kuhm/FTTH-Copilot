/**
 * P1.4 — backfill / recompute job for `verdict_log`.
 *
 * Why this script exists:
 *   The `verdict_log` table was created empty — all historical chat
 *   completions lack verdict_log rows. When classification logic changes
 *   (thresholds, severity mappings, completeness rules), old rows need
 *   recomputing. AD-7 in the design doc says:
 *
 *   > Backfill via recompute over `Message.toolCalls[*].result` envelopes
 *   > using existing `classifyEnvelope` / `classifyUnwrapped` — Replay
 *   > LLM runs — Pure function over already-stored JSON → idempotent,
 *   > deterministic, no API key.
 *
 * Contract:
 *   - Reads every assistant message with non-null `toolCalls` JSON.
 *   - Parses each tool call's `result` string through the same
 *     classification path the live chat route uses.
 *   - Builds `VerdictLogEntryInput` rows via `buildVerdictLogEntries`.
 *   - Writes via idempotent delete-then-insert per message inside a
 *     `$transaction` (no partial states).
 *   - Resolves `tenantId` by joining through `Conversation` (batched).
 *
 * Idempotency: running the script twice produces identical `verdict_log`
 * rows because each message's existing rows are deleted before reinsert.
 *
 * Usage:
 *   pnpm --filter @ftth-copilot/eval run backfill-verdict-log
 *   pnpm --filter @ftth-copilot/eval run backfill-verdict-log -- --dry-run
 *   pnpm --filter @ftth-copilot/eval run backfill-verdict-log -- --tenant <id>
 *   pnpm --filter @ftth-copilot/eval run backfill-verdict-log -- --limit 100
 *
 * The script is importable as a module so the unit test
 * (`tests/backfill-verdict-log.test.ts`) can call `backfillVerdictLog`
 * directly with mocked deps.
 */
import { Prisma, prisma } from '@ftth-copilot/db';
import { classifyEnvelope, classifyUnwrapped, type Verdict } from '@ftth-copilot/evidence';
import { buildVerdictLogEntries, type VerdictLogEntryInput } from '../src/verdict-log-writer';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * Shape of a single tool-call object stored in `Message.toolCalls` JSON.
 * Matches the `ToolCallRecord` shape from `@ftth-copilot/shared`:
 *   `{ name: string, arguments: string, result: string }`
 */
interface StoredToolCall {
  name: string;
  arguments: string;
  result: string;
}

/**
 * Minimal message projection for the backfill. We only need the fields
 * required to classify tool calls and build verdict log entries.
 */
interface BackfillMessage {
  id: string;
  conversationId: string | null;
  toolCalls: unknown;
  createdAt: Date;
}

/**
 * Options for the backfill operation.
 */
export interface BackfillVerdictLogOpts {
  /** When true, log what would be done without writing to the DB. */
  dryRun?: boolean;
  /** Filter to a specific tenant. When set, only messages belonging to
   *  conversations in this tenant are processed. */
  tenantId?: string;
  /** Process at most N messages. Useful for testing / incremental runs. */
  limit?: number;
}

/**
 * Result returned by the backfill operation for testability.
 */
export interface BackfillResult {
  /** Total number of assistant messages scanned. */
  messagesScanned: number;
  /** Total number of verdict log entries written (or would be written in
   *  dry-run mode). */
  entriesWritten: number;
  /** Total number of messages that were upserted (had their verdict_log
   *  rows deleted + reinserted). */
  messagesUpserted: number;
}

// ── Classification (Option B — inline reimplementation) ──────────────────────

/**
 * Classify a single tool result string. Replicates the logic from
 * `packages/agent-core/src/runtime.ts` (line ~269) without importing
 * `@ftth-copilot/agent-core` — keeping the backfill script dependency-free
 * on the agent runtime. The eval package already depends on
 * `@ftth-copilot/evidence` which exports `classifyEnvelope` and
 * `classifyUnwrapped`.
 *
 * Contract: identical output to the live `classifyToolResult` for the same
 * `(raw, toolName)` pair. Observe mode — never gates data flow.
 */
export function classifyToolResult(raw: string, toolName: string): Verdict {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      toolName,
      code: 'incomplete',
      reason: 'parse-error',
      severity: 'critical',
    };
  }
  if (parsed === null || typeof parsed !== 'object') {
    return classifyUnwrapped(toolName);
  }
  return classifyEnvelope(parsed, toolName);
}

// ── Core backfill logic ──────────────────────────────────────────────────────

/**
 * Core backfill function. Extracted from `main()` so the unit test can
 * call it with a mocked Prisma client and assert the classification +
 * write logic without spawning a subprocess.
 */
export async function backfillVerdictLog(
  opts: BackfillVerdictLogOpts = {},
): Promise<BackfillResult> {
  const where: Record<string, unknown> = {
    role: 'assistant',
    toolCalls: { not: Prisma.DbNull },
  };

  const messages = await prisma.message.findMany({
    where,
    select: { id: true, conversationId: true, toolCalls: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
    ...(opts.limit !== undefined ? { take: opts.limit } : {}),
  });

  // ── Batch-resolve tenantId via Conversation ──────────────────────────────
  // Collect unique conversationIds, fetch all conversations in one query,
  // and cache by ID. This avoids N+1 queries on the message loop.
  const conversationIds = [
    ...new Set(
      messages
        .map((m) => m.conversationId)
        .filter((id): id is string => id !== null),
    ),
  ];

  const conversations = await prisma.conversation.findMany({
    where: { id: { in: conversationIds } },
    select: { id: true, tenantId: true },
  });

  const tenantByConversation = new Map<string, string>(
    conversations.map((c) => [c.id, c.tenantId]),
  );

  // ── Filter by tenant if requested ────────────────────────────────────────
  let filteredMessages = messages;
  if (opts.tenantId !== undefined) {
    filteredMessages = messages.filter((m) => {
      if (m.conversationId === null) return false;
      return tenantByConversation.get(m.conversationId) === opts.tenantId;
    });
  }

  // ── Classify + write ─────────────────────────────────────────────────────
  let entriesWritten = 0;
  let messagesUpserted = 0;
  const PROGRESS_INTERVAL = 100;

  for (let i = 0; i < filteredMessages.length; i++) {
    const message = filteredMessages[i];

    // Resolve tenantId from the conversation cache.
    const tenantId =
      message.conversationId !== null
        ? tenantByConversation.get(message.conversationId)
        : undefined;

    // Skip messages with no resolvable tenant (orphaned conversations).
    if (tenantId === undefined) continue;

    // Parse toolCalls JSON. The `toolCalls` column is `Json?` — when
    // non-null Prisma returns it as an unknown JSON value.
    const toolCallsRaw = message.toolCalls;
    if (!Array.isArray(toolCallsRaw)) continue;

    const toolCalls = toolCallsRaw as unknown as StoredToolCall[];

    // Classify each tool call's result.
    const verdicts: Verdict[] = [];
    for (const tc of toolCalls) {
      if (typeof tc.result !== 'string') continue;
      verdicts.push(classifyToolResult(tc.result, tc.name));
    }

    if (verdicts.length === 0) continue;

    // Build verdict log entries via the existing pure builder.
    const entries = buildVerdictLogEntries(verdicts, {
      tenantId,
      messageId: message.id,
      conversationId: message.conversationId ?? undefined,
      observedAt: message.createdAt.toISOString(),
    });

    if (opts.dryRun) {
      entriesWritten += entries.length;
      messagesUpserted++;
    } else {
      // Idempotent upsert: delete existing rows for this message, then
      // insert the new ones. Both operations run inside a $transaction
      // so the verdict_log is never in a partial state.
      await prisma.$transaction([
        prisma.verdictLog.deleteMany({ where: { messageId: message.id } }),
        prisma.verdictLog.createMany({
          data: entries.map((e) => ({
            tenantId: e.tenantId,
            messageId: e.messageId ?? message.id,
            conversationId: e.conversationId ?? message.conversationId ?? null,
            toolName: e.toolName,
            code: e.code,
            severity: e.severity,
            ...(e.observedAt !== undefined ? { observedAt: new Date(e.observedAt) } : {}),
            injectionSuspicion: e.injectionSuspicion ?? false,
          })),
        }),
      ]);
      entriesWritten += entries.length;
      messagesUpserted++;
    }

    // Progress logging every PROGRESS_INTERVAL messages.
    if ((i + 1) % PROGRESS_INTERVAL === 0) {
      // eslint-disable-next-line no-console
      console.log(
        `backfill-verdict-log: processed ${i + 1}/${filteredMessages.length} messages ` +
          `(${entriesWritten} entries, ${messagesUpserted} upserted)`,
      );
    }
  }

  return { messagesScanned: filteredMessages.length, entriesWritten, messagesUpserted };
}

// ── CLI entry point ──────────────────────────────────────────────────────────

/**
 * CLI entry point. Follows the same pattern as `metrics-report.ts`:
 * resolves paths from `import.meta.url`, parses minimal CLI flags, and
 * calls `backfillVerdictLog` with the resolved options.
 *
 * Flags:
 *   --dry-run      Log what would be done without writing.
 *   --tenant <id>  Filter to a specific tenant.
 *   --limit <n>    Process at most N messages.
 */
async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  // Parse CLI flags. Minimal hand-rolled parser — the CLI surface is
  // intentionally small so we don't pull in a dependency. Unknown flags
  // are silently ignored to stay forward-compatible.
  let dryRun = false;
  let tenantId: string | undefined;
  let limit: number | undefined;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dry-run') {
      dryRun = true;
    } else if (argv[i] === '--tenant' && i + 1 < argv.length) {
      tenantId = argv[i + 1];
      i++;
    } else if (argv[i] === '--limit' && i + 1 < argv.length) {
      const parsed = Number(argv[i + 1]);
      if (!Number.isNaN(parsed) && parsed > 0) {
        limit = parsed;
      }
      i++;
    }
  }

  if (dryRun) {
    // eslint-disable-next-line no-console
    console.log('backfill-verdict-log: DRY RUN — no writes');
  }

  try {
    const result = await backfillVerdictLog({ dryRun, tenantId, limit });
    // eslint-disable-next-line no-console
    console.log(`backfill-verdict-log: done`);
    // eslint-disable-next-line no-console
    console.log(`  messages scanned: ${result.messagesScanned}`);
    // eslint-disable-next-line no-console
    console.log(`  messages upserted: ${result.messagesUpserted}`);
    // eslint-disable-next-line no-console
    console.log(`  entries written: ${result.entriesWritten}`);
    process.exit(0);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('backfill-verdict-log: unexpected error');
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  }
}

// Detect CLI invocation (same pattern as metrics-report.ts).
const isCliInvocation =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isCliInvocation) {
  void main();
}
