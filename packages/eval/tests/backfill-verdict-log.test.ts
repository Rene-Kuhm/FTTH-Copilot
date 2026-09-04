/**
 * P1.4 — backfill-verdict-log tests.
 *
 * Contract under test:
 *   1. Parsing toolCalls JSON from a message and classifying each tool
 *      result through `classifyToolResult`.
 *   2. Building verdict log entries via `buildVerdictLogEntries` with the
 *      resolved tenantId + messageId + conversationId.
 *   3. The idempotent delete-then-insert logic (mock Prisma) — each
 *      message's existing rows are deleted before new ones are inserted.
 *   4. Dry-run mode — no Prisma writes, but the function returns correct
 *      counts.
 *   5. Tenant filtering — when `--tenant` is set, only matching messages
 *      are processed.
 *   6. Limit — at most N messages are processed.
 *
 * RED proof: before `scripts/backfill-verdict-log.ts` exists, every named
 * import resolves to `undefined` and the assertions fail.
 *
 * GREEN proof: after the script ships, the suite passes with the exact
 * classification semantics from `@ftth-copilot/evidence` and the
 * idempotent write semantics from the design doc.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Verdict } from '@ftth-copilot/evidence';

// ── Mock setup ───────────────────────────────────────────────────────────────
// We mock `@ftth-copilot/db` so the backfill module's top-level
// `import { prisma }` resolves to our stub. `vi.hoisted` is required so the
// factory can reference the mock fns (vi.mock is hoisted above the const
// declarations; without vi.hoisted the factory hits a TDZ ReferenceError).

const { mockFindMany, mockTransaction, mockDeleteMany, mockCreateMany } = vi.hoisted(() => ({
  mockFindMany: vi.fn(),
  mockTransaction: vi.fn(),
  mockDeleteMany: vi.fn(),
  mockCreateMany: vi.fn(),
}));

vi.mock('@ftth-copilot/db', () => ({
  Prisma: { DbNull: Symbol.for('Prisma.DbNull') },
  prisma: {
    message: { findMany: mockFindMany },
    conversation: { findMany: vi.fn().mockResolvedValue([]) },
    $transaction: mockTransaction,
    verdictLog: {
      deleteMany: mockDeleteMany,
      createMany: mockCreateMany,
    },
  },
}));

// Import AFTER the mock so the module picks up our stub.
import {
  classifyToolResult,
  backfillVerdictLog,
} from '../scripts/backfill-verdict-log';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal assistant message with toolCalls JSON. */
function makeMessage(
  id: string,
  conversationId: string | null,
  toolCalls: unknown,
  createdAt: string = '2026-09-01T10:00:00.000Z',
) {
  return { id, conversationId, toolCalls, createdAt: new Date(createdAt) };
}

/** Build a tool-call JSON string with a verifiable envelope result. */
function makeEnvelopeResult(overrides: Record<string, unknown> = {}): string {
  // Use "now" so the envelope is always fresh (not stale). The default
  // TTL of 1 hour means the envelope expires 1h after observedAt; using
  // current time guarantees freshness in tests.
  const now = new Date().toISOString();
  return JSON.stringify({
    schema: 'evidence.provenance.v1',
    source: 'test.poll',
    tenantId: 'tenant-abc',
    observedAt: now,
    ttlMs: 3_600_000,
    confidence: 0.8,
    completeness: 'complete',
    data: null,
    ...overrides,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockTransaction.mockImplementation(async (ops: unknown[]) => {
    // Simulate transaction: execute each Prisma operation in order.
    for (const op of ops) {
      await op;
    }
  });
  mockDeleteMany.mockResolvedValue({ count: 0 });
  mockCreateMany.mockResolvedValue({ count: 0 });
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('@ftth-copilot/eval — classifyToolResult (inline Option B)', () => {
  it('classifies a valid envelope as ok when confidence is high and completeness is complete', () => {
    const raw = makeEnvelopeResult();
    const verdict = classifyToolResult(raw, 'list_onus');
    expect(verdict).toEqual({
      toolName: 'list_onus',
      code: 'ok',
      reason: 'fresh-complete',
      severity: 'ok',
    });
  });

  it('classifies a low-confidence envelope as low_confidence / warning', () => {
    const raw = makeEnvelopeResult({ confidence: 0.1 });
    const verdict = classifyToolResult(raw, 'get_onu_detail');
    expect(verdict.code).toBe('low_confidence');
    expect(verdict.severity).toBe('warning');
  });

  it('classifies a partial-completeness envelope as incomplete / warning', () => {
    const raw = makeEnvelopeResult({ completeness: 'partial' });
    const verdict = classifyToolResult(raw, 'list_olts');
    expect(verdict.code).toBe('incomplete');
    expect(verdict.severity).toBe('warning');
  });

  it('classifies a stale envelope (expired TTL) as stale / warning', () => {
    const raw = makeEnvelopeResult({
      observedAt: '2020-01-01T00:00:00.000Z',
      ttlMs: 1000, // expired long ago
    });
    const verdict = classifyToolResult(raw, 'list_onus');
    expect(verdict.code).toBe('stale');
    expect(verdict.severity).toBe('warning');
  });

  it('classifies unparseable JSON as incomplete / parse-error / critical', () => {
    const verdict = classifyToolResult('not-json{', 'some_tool');
    expect(verdict).toEqual({
      toolName: 'some_tool',
      code: 'incomplete',
      reason: 'parse-error',
      severity: 'critical',
    });
  });

  it('classifies a non-object JSON value as incomplete / no-envelope / critical', () => {
    const verdict = classifyToolResult('"just a string"', 'some_tool');
    expect(verdict).toEqual({
      toolName: 'some_tool',
      code: 'incomplete',
      reason: 'no-envelope',
      severity: 'critical',
    });
  });

  it('classifies null JSON as incomplete / no-envelope / critical', () => {
    const verdict = classifyToolResult('null', 'some_tool');
    expect(verdict).toEqual({
      toolName: 'some_tool',
      code: 'incomplete',
      reason: 'no-envelope',
      severity: 'critical',
    });
  });

  it('classifies a non-envelope object (missing required fields) as incomplete / parse-error', () => {
    const raw = JSON.stringify({ foo: 'bar' });
    const verdict = classifyToolResult(raw, 'some_tool');
    expect(verdict.code).toBe('incomplete');
    expect(verdict.reason).toBe('parse-error');
  });
});

describe('@ftth-copilot/eval — backfillVerdictLog (P1.4)', () => {
  it('parses toolCalls JSON and writes verdict log entries via Prisma', async () => {
    // Setup: one message with two tool calls.
    const envelope = makeEnvelopeResult();
    const toolCalls = [
      { name: 'list_onus', arguments: '{}', result: envelope },
      { name: 'get_onu_detail', arguments: '{}', result: 'not-json{' },
    ];
    const msg = makeMessage('msg-1', 'conv-1', toolCalls);

    mockFindMany.mockResolvedValueOnce([msg]);
    // conversation findMany for tenant resolution
    const convFindMany = vi.fn().mockResolvedValue([
      { id: 'conv-1', tenantId: 'tenant-abc' },
    ]);
    const { prisma } = await import('@ftth-copilot/db');
    (prisma.conversation.findMany as ReturnType<typeof vi.fn>).mockImplementationOnce(
      convFindMany,
    );

    const result = await backfillVerdictLog();

    expect(result.messagesScanned).toBe(1);
    expect(result.messagesUpserted).toBe(1);
    // Two tool calls → two verdicts → two entries.
    expect(result.entriesWritten).toBe(2);

    // Transaction was called once (one message).
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    // deleteMany was called with the message's id.
    expect(mockDeleteMany).toHaveBeenCalledWith({ where: { messageId: 'msg-1' } });
    // createMany was called with two entries.
    expect(mockCreateMany).toHaveBeenCalledTimes(1);
    const createData = mockCreateMany.mock.calls[0][0].data;
    expect(createData).toHaveLength(2);
    // First entry: list_onus → ok
    expect(createData[0]).toMatchObject({
      tenantId: 'tenant-abc',
      messageId: 'msg-1',
      conversationId: 'conv-1',
      toolName: 'list_onus',
      code: 'ok',
    });
    // Second entry: get_onu_detail → incomplete (parse-error, critical)
    // Note: `reason` is on Verdict but NOT on VerdictLogEntryInput or the
    // Prisma model — only `code` + `severity` are persisted.
    expect(createData[1]).toMatchObject({
      tenantId: 'tenant-abc',
      messageId: 'msg-1',
      conversationId: 'conv-1',
      toolName: 'get_onu_detail',
      code: 'incomplete',
      severity: 'critical',
    });
  });

  it('skips messages with null toolCalls', async () => {
    const msg = makeMessage('msg-2', 'conv-1', null);
    mockFindMany.mockResolvedValueOnce([msg]);

    const result = await backfillVerdictLog();

    expect(result.messagesScanned).toBe(1);
    expect(result.messagesUpserted).toBe(0);
    expect(result.entriesWritten).toBe(0);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('skips messages with no resolvable tenant (orphaned conversation)', async () => {
    const msg = makeMessage('msg-3', 'conv-orphan', [
      { name: 'list_onus', arguments: '{}', result: makeEnvelopeResult() },
    ]);
    mockFindMany.mockResolvedValueOnce([msg]);
    // conversation findMany returns empty — no tenant for this conversation.
    const { prisma } = await import('@ftth-copilot/db');
    (prisma.conversation.findMany as ReturnType<typeof vi.fn>).mockImplementationOnce(
      vi.fn().mockResolvedValue([]),
    );

    const result = await backfillVerdictLog();

    expect(result.messagesScanned).toBe(1);
    expect(result.messagesUpserted).toBe(0);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('is idempotent — running twice produces identical results', async () => {
    const envelope = makeEnvelopeResult();
    const msg = makeMessage('msg-4', 'conv-1', [
      { name: 'list_onus', arguments: '{}', result: envelope },
    ]);

    // Both calls return the same message.
    mockFindMany.mockResolvedValue([msg]);
    const { prisma } = await import('@ftth-copilot/db');
    (prisma.conversation.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'conv-1', tenantId: 'tenant-abc' },
    ]);

    const r1 = await backfillVerdictLog();
    const r2 = await backfillVerdictLog();

    expect(r1).toEqual(r2);
    // Each run produces one transaction (deleteMany + createMany).
    expect(mockTransaction).toHaveBeenCalledTimes(2);
    // Each transaction deletes first.
    expect(mockDeleteMany).toHaveBeenCalledTimes(2);
    expect(mockDeleteMany).toHaveBeenCalledWith({ where: { messageId: 'msg-4' } });
  });

  it('dry-run mode does not write to the DB', async () => {
    const msg = makeMessage('msg-5', 'conv-1', [
      { name: 'list_onus', arguments: '{}', result: makeEnvelopeResult() },
    ]);
    mockFindMany.mockResolvedValueOnce([msg]);
    const { prisma } = await import('@ftth-copilot/db');
    (prisma.conversation.findMany as ReturnType<typeof vi.fn>).mockImplementationOnce(
      vi.fn().mockResolvedValue([{ id: 'conv-1', tenantId: 'tenant-abc' }]),
    );

    const result = await backfillVerdictLog({ dryRun: true });

    expect(result.messagesScanned).toBe(1);
    expect(result.messagesUpserted).toBe(1);
    expect(result.entriesWritten).toBe(1);
    // No transaction, no writes.
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockDeleteMany).not.toHaveBeenCalled();
    expect(mockCreateMany).not.toHaveBeenCalled();
  });

  it('filters messages by tenant when tenantId is provided', async () => {
    const envelope = makeEnvelopeResult();
    const msgA = makeMessage('msg-a', 'conv-a', [
      { name: 'list_onus', arguments: '{}', result: envelope },
    ]);
    const msgB = makeMessage('msg-b', 'conv-b', [
      { name: 'list_olts', arguments: '{}', result: envelope },
    ]);
    mockFindMany.mockResolvedValueOnce([msgA, msgB]);
    const { prisma } = await import('@ftth-copilot/db');
    (prisma.conversation.findMany as ReturnType<typeof vi.fn>).mockImplementationOnce(
      vi.fn().mockResolvedValue([
        { id: 'conv-a', tenantId: 'tenant-alpha' },
        { id: 'conv-b', tenantId: 'tenant-beta' },
      ]),
    );

    const result = await backfillVerdictLog({ tenantId: 'tenant-alpha' });

    // Only msg-a belongs to tenant-alpha (in-memory filter).
    expect(result.messagesScanned).toBe(1);
    expect(result.messagesUpserted).toBe(1);
    expect(result.entriesWritten).toBe(1);
    // Only one transaction (for msg-a).
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockDeleteMany).toHaveBeenCalledWith({ where: { messageId: 'msg-a' } });
  });

  it('respects the limit option', async () => {
    const envelope = makeEnvelopeResult();
    const messages = Array.from({ length: 10 }, (_, i) =>
      makeMessage(`msg-${i}`, 'conv-1', [
        { name: 'list_onus', arguments: '{}', result: envelope },
      ]),
    );
    // First call returns only 3 messages (simulating Prisma take: 3).
    mockFindMany.mockResolvedValueOnce(messages.slice(0, 3));
    const { prisma } = await import('@ftth-copilot/db');
    (prisma.conversation.findMany as ReturnType<typeof vi.fn>).mockImplementationOnce(
      vi.fn().mockResolvedValue([{ id: 'conv-1', tenantId: 'tenant-abc' }]),
    );

    const result = await backfillVerdictLog({ limit: 3 });

    expect(result.messagesScanned).toBe(3);
    expect(result.messagesUpserted).toBe(3);
    expect(result.entriesWritten).toBe(3);
    expect(mockTransaction).toHaveBeenCalledTimes(3);
  });

  it('stamps observedAt from the message createdAt', async () => {
    const envelope = makeEnvelopeResult();
    const msg = makeMessage('msg-6', 'conv-1', [
      { name: 'list_onus', arguments: '{}', result: envelope },
    ], '2026-06-15T14:30:00.000Z');
    mockFindMany.mockResolvedValueOnce([msg]);
    const { prisma } = await import('@ftth-copilot/db');
    (prisma.conversation.findMany as ReturnType<typeof vi.fn>).mockImplementationOnce(
      vi.fn().mockResolvedValue([{ id: 'conv-1', tenantId: 'tenant-abc' }]),
    );

    await backfillVerdictLog();

    const createData = mockCreateMany.mock.calls[0][0].data;
    expect(createData[0].observedAt).toEqual(new Date('2026-06-15T14:30:00.000Z'));
  });

  it('handles tool calls with non-string result gracefully (skips classification)', async () => {
    const msg = makeMessage('msg-7', 'conv-1', [
      { name: 'list_onus', arguments: '{}', result: 42 }, // non-string result
      {
        name: 'get_detail',
        arguments: '{}',
        result: makeEnvelopeResult(),
      },
    ]);
    mockFindMany.mockResolvedValueOnce([msg]);
    const { prisma } = await import('@ftth-copilot/db');
    (prisma.conversation.findMany as ReturnType<typeof vi.fn>).mockImplementationOnce(
      vi.fn().mockResolvedValue([{ id: 'conv-1', tenantId: 'tenant-abc' }]),
    );

    const result = await backfillVerdictLog();

    // Only one valid tool call (the second one).
    expect(result.entriesWritten).toBe(1);
    const createData = mockCreateMany.mock.calls[0][0].data;
    expect(createData[0].toolName).toBe('get_detail');
  });

  it('returns zero counts when no messages exist', async () => {
    mockFindMany.mockResolvedValueOnce([]);

    const result = await backfillVerdictLog();

    expect(result).toEqual({
      messagesScanned: 0,
      entriesWritten: 0,
      messagesUpserted: 0,
    });
    expect(mockTransaction).not.toHaveBeenCalled();
  });
});
