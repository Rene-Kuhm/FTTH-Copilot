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
  },
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
