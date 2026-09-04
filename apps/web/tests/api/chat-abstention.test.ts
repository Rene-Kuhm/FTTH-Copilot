import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * RED tests for the strict-mode abstention persistence path on
 * `apps/web/app/api/chat/route.ts` (Phase 3, task 3.1 + 3.2).
 *
 * Contract under test:
 *   1. `process.env.TRUTH_GATE_MODE` is read by the route and forwarded to
 *      `runAgent` as `opts.mode` (default `'strict'`).
 *   2. When `runAgent` returns `{ abstained: true, text, abstention }` the
 *      route persists the rendered Spanish text into `Message.content` and
 *      appends `{ name: '__abstention__', arguments: {}, result: abstention }`
 *      to `Message.toolCalls`. The HTTP response carries the `abstention`
 *      envelope too.
 *   3. When `runAgent` returns a normal result (no `abstained`), no
 *      `__abstention__` row is added and the response has no `abstention`.
 *
 * The route imports server-only modules that we don't want to execute during
 * a unit test. Each one is replaced with a `vi.mock` whose functions are
 * hoisted via `vi.hoisted`.
 */

const mocks = vi.hoisted(() => ({
  runAgent: vi.fn(),
  prismaConversationFindFirst: vi.fn(),
  prismaConversationCreate: vi.fn(),
  prismaConversationUpdate: vi.fn(),
  prismaMessageCreate: vi.fn(),
  prismaMessageFindMany: vi.fn(),
  prismaAgentActionLogCreate: vi.fn(),
  prismaDetectedAlertFindMany: vi.fn(),
  prismaConfirmedIncidentFindMany: vi.fn(),
  prismaPendingIncidentCandidateCreate: vi.fn(),
  prismaTenantPolicyFindUnique: vi.fn(),
  // Fase F — verdictLog.write surface. The chat route calls
  // `prisma.verdictLog.createMany` once per chat completion when
  // `result.verdicts` is non-empty. Wrapped in a try/catch so a thrown
  // promise (e.g. DB blip) keeps the chat at HTTP 200.
  prismaVerdictLogCreateMany: vi.fn(),
  loadTenantPolicy: vi.fn(),
  getCurrentUser: vi.fn(),
  hasPermission: vi.fn(),
  resolveTenantConnector: vi.fn(),
  consumeChatQuota: vi.fn(),
  logRequest: vi.fn(),
}));

vi.mock('@ftth-copilot/agent-core', () => ({
  runAgent: mocks.runAgent,
}));

vi.mock('@ftth-copilot/db', () => ({
  prisma: {
    conversation: {
      findFirst: mocks.prismaConversationFindFirst,
      create: mocks.prismaConversationCreate,
      update: mocks.prismaConversationUpdate,
    },
    message: {
      create: mocks.prismaMessageCreate,
      findMany: mocks.prismaMessageFindMany,
    },
    agentActionLog: {
      create: mocks.prismaAgentActionLogCreate,
    },
    detectedAlert: {
      findMany: mocks.prismaDetectedAlertFindMany,
    },
    confirmedIncident: {
      findMany: mocks.prismaConfirmedIncidentFindMany,
    },
    pendingIncidentCandidate: {
      create: mocks.prismaPendingIncidentCandidateCreate,
    },
    tenantPolicy: {
      findUnique: mocks.prismaTenantPolicyFindUnique,
    },
    verdictLog: {
      createMany: mocks.prismaVerdictLogCreateMany,
    },
  },
}));

vi.mock('@/lib/policies/load-tenant-policy', () => ({
  loadTenantPolicy: mocks.loadTenantPolicy,
}));

vi.mock('@/lib/auth/server', () => ({
  getCurrentUser: mocks.getCurrentUser,
}));

vi.mock('@/lib/auth/permissions', () => ({
  hasPermission: mocks.hasPermission,
}));

vi.mock('@/lib/connectors/chat-client', () => ({
  resolveTenantConnector: mocks.resolveTenantConnector,
  ConnectorResolutionError: class ConnectorResolutionError extends Error {
    constructor(message: string, readonly status: number) {
      super(message);
      this.name = 'ConnectorResolutionError';
    }
  },
}));

vi.mock('@/lib/rate-limit', () => ({
  consumeChatQuota: mocks.consumeChatQuota,
}));

vi.mock('@/lib/logging', () => ({
  logRequest: mocks.logRequest,
}));

const ABSTENTION_ENVELOPE = {
  schema: 'ftth.abstention.v1',
  reason: 'incomplete',
  severity: 'critical',
  missing: ['get_onu_detail'],
  available: [],
  nextStep:
    'No pude respaldar el diagnóstico: el identificador get_onu_detail no figura en el NMS. Verificá el identificador (ID, SN o filtro) y volvé a intentar.',
  toolsAffected: ['get_onu_detail'],
};

const ABSTENTION_TEXT =
  'No puedo responder con la evidencia disponible.\n\n' +
  'Falta evidencia de:\n' +
  '- get_onu_detail\n\n' +
  ABSTENTION_ENVELOPE.nextStep;

const fakeConnector = {
  providerName: 'test',
  listOlts: vi.fn(async () => []),
};

const fakeDataSource = {
  mode: 'live' as const,
  connectionId: 'conn-1',
  provider: 'SMARTOLT' as const,
  label: 'Producción',
};

const fakeUser = {
  id: 'user-1',
  email: 'ops@isp.com',
  name: 'Ops',
  role: 'OWNER' as const,
  tenantId: 'tenant-1',
  tenant: { id: 'tenant-1', name: 'ISP', slug: 'isp' },
};

const createdConversation = { id: 'conv-1', connectionId: 'conn-1' };

function setupHappyPath() {
  mocks.getCurrentUser.mockReset();
  mocks.hasPermission.mockReset();
  mocks.resolveTenantConnector.mockReset();
  mocks.consumeChatQuota.mockReset();
  mocks.prismaConversationFindFirst.mockReset();
  mocks.prismaConversationCreate.mockReset();
  mocks.prismaMessageCreate.mockReset();
  mocks.prismaAgentActionLogCreate.mockReset();
  mocks.prismaDetectedAlertFindMany.mockReset();
  mocks.prismaConfirmedIncidentFindMany.mockReset();
  mocks.prismaPendingIncidentCandidateCreate.mockReset();
  mocks.prismaTenantPolicyFindUnique.mockReset();
  // Fase F — verdictLog default: success. The chat route's try/catch
  // surrounds `createMany`; tests that want the fail-safe path override
  // this with `mockRejectedValueOnce`.
  mocks.prismaVerdictLogCreateMany.mockReset();
  mocks.loadTenantPolicy.mockReset();
  mocks.getCurrentUser.mockResolvedValue(fakeUser);
  mocks.hasPermission.mockReturnValue(true);
  mocks.resolveTenantConnector.mockResolvedValue({
    connector: fakeConnector,
    dataSource: fakeDataSource,
  });
  mocks.consumeChatQuota.mockResolvedValue({ allowed: true, retryAfter: 0 });
  mocks.prismaConversationFindFirst.mockResolvedValue(null);
  mocks.prismaConversationCreate.mockResolvedValue(createdConversation);
  mocks.prismaMessageCreate.mockResolvedValue({ id: 'msg' });
  mocks.prismaAgentActionLogCreate.mockResolvedValue({ id: 'log' });
  mocks.prismaDetectedAlertFindMany.mockResolvedValue([]);
  // WU3 — default: empty confirmed-incident window (retrieval short-circuits).
  mocks.prismaConfirmedIncidentFindMany.mockResolvedValue([]);
  // WU3 — default: write gate never fires in this suite (we assert the abstention
  // path explicitly, where the gate MUST stay closed).
  mocks.prismaPendingIncidentCandidateCreate.mockResolvedValue({ id: 'pending-1' });
  // Fase E — default: no TenantPolicy row → runAgent receives tenantPolicy: undefined.
  mocks.prismaTenantPolicyFindUnique.mockResolvedValue(null);
  mocks.loadTenantPolicy.mockResolvedValue(null);
  // Fase F — verdictLog default: success (count: 0 → no-op no-op shape).
  mocks.prismaVerdictLogCreateMany.mockResolvedValue({ count: 0 });
}

beforeEach(() => {
  setupHappyPath();
  delete process.env['TRUTH_GATE_MODE'];
  mocks.runAgent.mockReset();
});

afterEach(() => {
  delete process.env['TRUTH_GATE_MODE'];
});

async function callRoute(body: unknown): Promise<Response> {
  const { POST } = await import('@/app/api/chat/route');
  const req = new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return POST(req as unknown as Parameters<typeof POST>[0]);
}

function findAssistantCreate() {
  const calls = mocks.prismaMessageCreate.mock.calls;
  return calls.find((c) => (c[0] as { data: { role: string } }).data.role === 'assistant');
}

describe('POST /api/chat — TRUTH_GATE_MODE passthrough', () => {
  it('forwards TRUTH_GATE_MODE=observe to runAgent as opts.mode', async () => {
    process.env['TRUTH_GATE_MODE'] = 'observe';
    mocks.runAgent.mockResolvedValueOnce({
      text: 'respuesta normal',
      toolCalls: [],
      verdicts: [],
    });

    const res = await callRoute({ message: 'hola' });

    expect(res.status).toBe(200);
    expect(mocks.runAgent).toHaveBeenCalledTimes(1);
    expect(mocks.runAgent.mock.calls[0]?.[0]).toMatchObject({ mode: 'observe' });
  });

  it('defaults to mode=strict when TRUTH_GATE_MODE is unset', async () => {
    mocks.runAgent.mockResolvedValueOnce({
      text: 'respuesta normal',
      toolCalls: [],
      verdicts: [],
    });

    const res = await callRoute({ message: 'hola' });

    expect(res.status).toBe(200);
    expect(mocks.runAgent.mock.calls[0]?.[0]).toMatchObject({ mode: 'strict' });
  });
});

describe('POST /api/chat — strict-mode abstention persistence', () => {
  beforeEach(() => {
    process.env['TRUTH_GATE_MODE'] = 'strict';
    mocks.runAgent.mockResolvedValueOnce({
      text: ABSTENTION_TEXT,
      toolCalls: [],
      verdicts: [
        {
          toolName: 'get_onu_detail',
          code: 'incomplete',
          reason: 'no-envelope',
          severity: 'critical',
        },
      ],
      abstention: ABSTENTION_ENVELOPE,
      abstained: true,
    });
  });

  it('writes result.text into Message.content', async () => {
    await callRoute({ message: 'detalle de la ONU SN-001' });
    const assistantCall = findAssistantCreate();
    expect(assistantCall).toBeDefined();
    expect((assistantCall![0] as { data: { content: string } }).data.content).toBe(
      ABSTENTION_TEXT,
    );
  });

  it('appends a __abstention__ synthetic row to Message.toolCalls', async () => {
    await callRoute({ message: 'detalle de la ONU SN-001' });
    const assistantCall = findAssistantCreate();
    const toolCalls = (assistantCall![0] as { data: { toolCalls?: unknown[] } }).data
      .toolCalls;
    expect(Array.isArray(toolCalls)).toBe(true);
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls![0]).toEqual({
      name: '__abstention__',
      arguments: {},
      result: ABSTENTION_ENVELOPE,
    });
  });

  it('attaches the abstention envelope to the HTTP response', async () => {
    const res = await callRoute({ message: 'detalle de la ONU SN-001' });
    const body = (await res.json()) as { abstention?: typeof ABSTENTION_ENVELOPE };
    expect(body.abstention).toEqual(ABSTENTION_ENVELOPE);
  });
});

describe('POST /api/chat — observe-mode non-abstention persistence', () => {
  beforeEach(() => {
    process.env['TRUTH_GATE_MODE'] = 'observe';
    mocks.runAgent.mockResolvedValueOnce({
      text: 'Reporte normal del LLM.',
      toolCalls: [
        {
          name: 'list_onus',
          arguments: {},
          result: '[]',
        },
      ],
      verdicts: [
        {
          toolName: 'list_onus',
          code: 'ok',
          reason: 'fresh',
          severity: 'info',
        },
      ],
      // No abstention/abstained fields — observe-mode keeps Fase B behaviour.
    });
  });

  it('writes result.text into Message.content verbatim', async () => {
    await callRoute({ message: 'listar ONUs' });
    const assistantCall = findAssistantCreate();
    expect((assistantCall![0] as { data: { content: string } }).data.content).toBe(
      'Reporte normal del LLM.',
    );
  });

  it('does NOT append a __abstention__ row to Message.toolCalls', async () => {
    await callRoute({ message: 'listar ONUs' });
    const assistantCall = findAssistantCreate();
    const toolCalls = (assistantCall![0] as { data: { toolCalls?: unknown[] } }).data
      .toolCalls;
    expect(toolCalls).toEqual([
      { name: 'list_onus', arguments: {}, result: '[]' },
    ]);
    expect(toolCalls?.some((t) => (t as { name: string }).name === '__abstention__')).toBe(
      false,
    );
  });

  it('does NOT include abstention in the HTTP response', async () => {
    const res = await callRoute({ message: 'listar ONUs' });
    const body = (await res.json()) as { abstention?: unknown };
    expect(body.abstention).toBeUndefined();
  });
});

/**
 * Fase F — verdict_log persistence path (F-5.2 — chat-route writes).
 *
 * Contract under test:
 *   1. When `runAgent` returns `result.warnings: VerdictCode[]` (the F-3
 *      'warn' finalize branch), the chat route persists exactly one
 *      `AgentActionLog` row with `toolName === '__injection_suspicion__'`
 *      carrying the warn codes.
 *   2. When `runAgent` returns NO warnings, NO `__injection_suspicion__`
 *      row is written — the chat route does not emit a row when warnings
 *      is empty.
 *   3. The chat route persists ONE `verdict_log` row per verdict in
 *      `result.verdicts` via `prisma.verdictLog.createMany`. Empty
 *      verdicts → zero rows (the createMany call is short-circuited).
 *   4. The `prisma.verdictLog.createMany` call is wrapped in a fail-safe
 *      try/catch — a thrown promise keeps the chat at HTTP 200.
 *   5. The chat route does NOT add a synthetic `__injection_suspicion__`
 *      row to `Message.toolCalls`; the warning bubble is surfaced via
 *      `result.warnings` for the API consumer (see also the API
 *      response contract below).
 *
 * RED proof: before F-5.2 wires the writer into the chat route, every
 * test below fails because the `__injection_suspicion__` row and the
 * `prismaVerdictLogCreateMany` call do not happen.
 *
 * GREEN proof: after F-5.2 ships, the chat route reads
 * `result.warnings` + `result.verdicts` and persists both side effects
 * inside fail-safe guards.
 */
describe('POST /api/chat — Fase F warn path + verdict_log persistence (F-5.2)', () => {
  function findSuspicionLogRow() {
    return mocks.prismaAgentActionLogCreate.mock.calls.find(
      (c) =>
        (c[0] as { data: { toolName: string } }).data.toolName ===
        '__injection_suspicion__',
    );
  }

  function findVerdictLogCreateManyArgs() {
    const call = mocks.prismaVerdictLogCreateMany.mock.calls[0];
    if (!call) return undefined;
    return (call[0] as { data: unknown[] }).data;
  }

  it('emits exactly one __injection_suspicion__ AgentActionLog row when result.warnings=[stale]', async () => {
    process.env['TRUTH_GATE_MODE'] = 'strict';
    mocks.runAgent.mockResolvedValueOnce({
      text: 'Reporte LLM (byte-identical).',
      toolCalls: [{ name: 'list_onus', arguments: {}, result: '[]' }],
      verdicts: [
        { toolName: 'list_onus', code: 'stale', reason: 'expired-ttl', severity: 'warning' },
      ],
      warnings: ['stale'],
    });

    const res = await callRoute({ message: 'stale' });

    expect(res.status).toBe(200);
    const suspicionRow = findSuspicionLogRow();
    expect(suspicionRow).toBeDefined();
    const data = (suspicionRow![0] as { data: Record<string, unknown> }).data;
    expect(data.toolName).toBe('__injection_suspicion__');
    expect(data.parameters).toEqual({
      mode: 'strict',
      warnCodes: ['stale'],
    });
  });

  it('packs both warn codes into the same __injection_suspicion__ row when warnings=[stale,low_confidence]', async () => {
    process.env['TRUTH_GATE_MODE'] = 'strict';
    mocks.runAgent.mockResolvedValueOnce({
      text: 'Reporte LLM (byte-identical).',
      toolCalls: [
        { name: 'list_onus', arguments: {}, result: '[]' },
        { name: 'list_olts', arguments: {}, result: '[]' },
      ],
      verdicts: [
        { toolName: 'list_onus', code: 'stale', reason: 'expired-ttl', severity: 'warning' },
        { toolName: 'list_olts', code: 'low_confidence', reason: 'low', severity: 'warning' },
      ],
      warnings: ['stale', 'low_confidence'],
    });

    await callRoute({ message: 'multi-warn' });

    const suspicionRows = mocks.prismaAgentActionLogCreate.mock.calls.filter(
      (c) =>
        (c[0] as { data: { toolName: string } }).data.toolName ===
        '__injection_suspicion__',
    );
    // Exactly one row regardless of how many warn codes were emitted.
    expect(suspicionRows).toHaveLength(1);
    const data = (suspicionRows[0]![0] as { data: Record<string, unknown> }).data;
    expect(data.parameters).toEqual({
      mode: 'strict',
      warnCodes: ['stale', 'low_confidence'],
    });
  });

  it('emits NO __injection_suspicion__ row when runAgent returns no warnings', async () => {
    process.env['TRUTH_GATE_MODE'] = 'strict';
    mocks.runAgent.mockResolvedValueOnce({
      text: 'Reporte normal.',
      toolCalls: [{ name: 'list_onus', arguments: {}, result: '[]' }],
      verdicts: [
        { toolName: 'list_onus', code: 'ok', reason: 'fresh', severity: 'info' },
      ],
      // No `warnings` field — allow path → chat route MUST NOT write the row.
    });

    await callRoute({ message: 'allow' });

    const suspicionRows = mocks.prismaAgentActionLogCreate.mock.calls.filter(
      (c) =>
        (c[0] as { data: { toolName: string } }).data.toolName ===
        '__injection_suspicion__',
    );
    expect(suspicionRows).toHaveLength(0);
  });

  it('persists verdict_log rows via createMany (one row per verdict)', async () => {
    process.env['TRUTH_GATE_MODE'] = 'strict';
    mocks.runAgent.mockResolvedValueOnce({
      text: 'Reporte LLM.',
      toolCalls: [
        { name: 'list_onus', arguments: {}, result: '[]' },
        { name: 'list_olts', arguments: {}, result: '[]' },
      ],
      verdicts: [
        { toolName: 'list_onus', code: 'ok', reason: 'fresh', severity: 'info' },
        { toolName: 'list_olts', code: 'stale', reason: 'expired-ttl', severity: 'warning' },
      ],
      warnings: ['stale'],
    });

    await callRoute({ message: 'verdict_log' });

    expect(mocks.prismaVerdictLogCreateMany).toHaveBeenCalledTimes(1);
    const entries = findVerdictLogCreateManyArgs() as Array<Record<string, unknown>>;
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      tenantId: 'tenant-1',
      toolName: 'list_onus',
      code: 'ok',
      severity: 'info',
      injectionSuspicion: false,
    });
    expect(entries[1]).toMatchObject({
      tenantId: 'tenant-1',
      toolName: 'list_olts',
      code: 'stale',
      severity: 'warning',
      injectionSuspicion: true,
    });
    // Correlation keys must be present (confirmed-incident-memory spec
    // §"Correlation keys present" scenario).
    for (const entry of entries) {
      expect(entry.tenantId).toBe('tenant-1');
      expect(typeof entry.messageId).toBe('string');
      expect((entry.messageId as string).length).toBeGreaterThan(0);
      expect(typeof entry.conversationId).toBe('string');
      expect((entry.conversationId as string).length).toBeGreaterThan(0);
    }
  });

  it('does NOT call prisma.verdictLog.createMany when verdicts is empty', async () => {
    process.env['TRUTH_GATE_MODE'] = 'strict';
    mocks.runAgent.mockResolvedValueOnce({
      text: 'Reporte sin tool calls.',
      toolCalls: [],
      verdicts: [],
      warnings: [],
    });

    await callRoute({ message: 'empty-verdicts' });

    // Empty `verdicts` → zero `verdict_log` rows → createMany is
    // skipped entirely (no wasted DB round-trip on the happy path).
    expect(mocks.prismaVerdictLogCreateMany).not.toHaveBeenCalled();
  });

  it('keeps the chat at HTTP 200 when prisma.verdictLog.createMany throws (fail-safe)', async () => {
    process.env['TRUTH_GATE_MODE'] = 'strict';
    mocks.prismaVerdictLogCreateMany.mockRejectedValueOnce(
      new Error('simulated DB blip'),
    );
    mocks.runAgent.mockResolvedValueOnce({
      text: 'Reporte LLM.',
      toolCalls: [{ name: 'list_onus', arguments: {}, result: '[]' }],
      verdicts: [
        { toolName: 'list_onus', code: 'stale', reason: 'expired-ttl', severity: 'warning' },
      ],
      warnings: ['stale'],
    });

    const res = await callRoute({ message: 'fail-safe' });

    // The fail-safe guarantee: a thrown `createMany` MUST NOT break chat.
    // The agent's LLM text already shipped to the operator; verdict_log
    // is observability-only and never gates the HTTP response.
    expect(res.status).toBe(200);
    const body = (await res.json()) as { reply: string };
    expect(body.reply).toBe('Reporte LLM.');
  });

  it('does NOT add a synthetic __injection_suspicion__ row to Message.toolCalls', async () => {
    process.env['TRUTH_GATE_MODE'] = 'strict';
    mocks.runAgent.mockResolvedValueOnce({
      text: 'Reporte LLM.',
      toolCalls: [{ name: 'list_onus', arguments: {}, result: '[]' }],
      verdicts: [
        { toolName: 'list_onus', code: 'stale', reason: 'expired-ttl', severity: 'warning' },
      ],
      warnings: ['stale'],
    });

    await callRoute({ message: 'no-tool-call-row' });

    const assistantCall = findAssistantCreate();
    const toolCalls = (assistantCall![0] as { data: { toolCalls?: unknown[] } }).data
      .toolCalls;
    // The only row persisted to toolCalls is the original `list_onus`
    // call; the chat route MUST NOT synthesize a __injection_suspicion__
    // row here (that bubble comes via the HTTP API surface, not the
    // Message audit JSON).
    expect(toolCalls).toEqual([
      { name: 'list_onus', arguments: {}, result: '[]' },
    ]);
    expect(
      (toolCalls as Array<{ name: string }>).some((t) => t.name === '__injection_suspicion__'),
    ).toBe(false);
  });
});
