import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * RED tests for the Fase D WU3 chat-route wiring on
 * `apps/web/app/api/chat/route.ts` (tasks D-3.1 + D-3.2).
 *
 * Contract under test:
 *  1. The route builds a `retrievalProvider` closure and forwards it to
 *     `runAgent` as `opts.retrievalProvider`. The closure queries Prisma
 *     `confirmedIncident` rows scoped to `user.tenantId` + a 90-day window
 *     and delegates to `retrieveRelevantIncidents` from `@ftth-copilot/evidence`.
 *  2. In demo mode the closure returns `[]` without querying the DB.
 *  3. When `runAgent` returns a clean result (`abstained !== true` and no
 *     verdict is `code === 'incomplete'`) the route writes exactly one
 *     `PendingIncidentCandidate` row with `status: 'pending'`. In every
 *     other case (abstained / any incomplete verdict / demo mode) the
 *     route writes zero rows.
 *
 * The test mocks mirror the existing `chat-abstention.test.ts` discipline:
 * every server-only dependency is replaced via `vi.mock` + `vi.hoisted`.
 */

const mocks = vi.hoisted(() => ({
  runAgent: vi.fn(),
  retrieveRelevantIncidents: vi.fn(),
  buildPendingIncidentCandidate: vi.fn(),
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

vi.mock('@ftth-copilot/evidence', () => ({
  retrieveRelevantIncidents: mocks.retrieveRelevantIncidents,
  buildPendingIncidentCandidate: mocks.buildPendingIncidentCandidate,
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

const fakeConnector = {
  providerName: 'test',
  listOlts: vi.fn(async () => []),
};

const fakeLiveDataSource = {
  mode: 'live' as const,
  connectionId: 'conn-1',
  provider: 'SMARTOLT' as const,
  label: 'Producción',
};

const fakeDemoDataSource = {
  mode: 'demo' as const,
  connectionId: 'conn-1',
  provider: 'SMARTOLT' as const,
  label: 'Demo',
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

/**
 * Drives the route into a stable, fully-mocked state. Each test then
 * overrides only the surface it cares about (`runAgent` return shape,
 * `resolveTenantConnector` dataSource, `retrieveRelevantIncidents` return).
 */
function setupHappyPath(overrides: {
  dataSource?: typeof fakeLiveDataSource | typeof fakeDemoDataSource;
} = {}) {
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
  mocks.retrieveRelevantIncidents.mockReset();
  mocks.buildPendingIncidentCandidate.mockReset();

  mocks.getCurrentUser.mockResolvedValue(fakeUser);
  mocks.hasPermission.mockReturnValue(true);
  mocks.resolveTenantConnector.mockResolvedValue({
    connector: fakeConnector,
    dataSource: overrides.dataSource ?? fakeLiveDataSource,
  });
  mocks.consumeChatQuota.mockResolvedValue({ allowed: true, retryAfter: 0 });
  mocks.prismaConversationFindFirst.mockResolvedValue(null);
  mocks.prismaConversationCreate.mockResolvedValue(createdConversation);
  mocks.prismaMessageCreate.mockResolvedValue({ id: 'msg' });
  mocks.prismaAgentActionLogCreate.mockResolvedValue({ id: 'log' });
  mocks.prismaDetectedAlertFindMany.mockResolvedValue([]);
  // Default: no confirmed incidents in the DB; retrieval short-circuits.
  mocks.prismaConfirmedIncidentFindMany.mockResolvedValue([]);
  mocks.prismaPendingIncidentCandidateCreate.mockResolvedValue({ id: 'pending-1' });
  // The pure-TS `retrieveRelevantIncidents` is the one the route calls; with
  // no rows it returns `[]`. The route forwards the result as-is.
  mocks.retrieveRelevantIncidents.mockImplementation((args: { confirmedIncidents?: unknown[] }) =>
    Array.isArray(args.confirmedIncidents) && args.confirmedIncidents.length > 0
      ? [
          {
            schema: 'ftth.confirmed-incident.v1',
            id: 'ci-1',
            tenantId: 'tenant-1',
            deviceKind: 'ONU',
            deviceId: 'onu-1',
            sourceTool: 'get_onu_detail',
            summary: 'RX bajo en la ONU',
            symptoms: [],
            rootCause: 'Conector sucio',
            fix: 'Limpieza',
            observedAt: '2026-08-30T12:00:00.000Z',
            resolvedAt: '2026-08-30T13:00:00.000Z',
            createdAt: '2026-08-30T12:00:00.000Z',
            updatedAt: '2026-08-30T13:00:00.000Z',
            confirmedBy: 'operator',
            searchTokens: ['rx', 'bajo'],
            score: 1,
          },
        ]
      : [],
  );
  // The pure constructor returns the draft the route forwards into Prisma.
  mocks.buildPendingIncidentCandidate.mockImplementation(
    (args: {
      tenantId: string;
      summary: string;
      toolCallsJson: unknown;
      runSessionId?: string;
    }) => ({
      schema: 'ftth.pending-incident-candidate.v1',
      id: '',
      tenantId: args.tenantId,
      summary: args.summary,
      toolCallsJson: args.toolCallsJson,
      runSessionId: args.runSessionId,
      proposedConfirmedAt: '2026-09-01T12:00:00.000Z',
      status: 'pending',
    }),
  );
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

const okToolCall = (overrides: Record<string, unknown> = {}) => ({
  name: 'list_onus',
  arguments: {},
  result: '{"schema":"evidence.provenance.v1","data":[]}',
  ...overrides,
});

describe('POST /api/chat — retrievalProvider wiring (Fase D / WU3)', () => {
  it('queries ConfirmedIncident rows scoped to tenantId + 90-day window and forwards to retrieveRelevantIncidents', async () => {
    // The DB returns one recent row in tenant scope; the pure-TS ranker
    // returns it back. The route must NOT short-circuit on live mode.
    mocks.prismaConfirmedIncidentFindMany.mockResolvedValue([
      {
        schema: 'ftth.confirmed-incident.v1',
        id: 'ci-1',
        tenantId: 'tenant-1',
        deviceKind: 'ONU',
        deviceId: 'onu-1',
        sourceTool: 'get_onu_detail',
        summary: 'RX bajo en la ONU',
        rootCause: 'Conector sucio',
        fix: 'Limpieza',
        symptoms: [],
        observedAt: new Date('2026-08-30T12:00:00.000Z'),
        resolvedAt: new Date('2026-08-30T13:00:00.000Z'),
        createdAt: new Date('2026-08-30T12:00:00.000Z'),
        updatedAt: new Date('2026-08-30T13:00:00.000Z'),
        confirmedBy: 'operator',
        searchTokens: ['rx', 'bajo'],
      },
    ]);
    mocks.runAgent.mockImplementation(
      async (opts: { retrievalProvider?: (args: unknown) => Promise<unknown[]> }) => {
        expect(opts.retrievalProvider).toBeDefined();
        const rows = await opts.retrievalProvider!({ tenantId: 'tenant-1', query: 'rx bajo' });
        expect(Array.isArray(rows)).toBe(true);
        expect(rows).toHaveLength(1);
        return {
          text: 'con contexto',
          toolCalls: [okToolCall()],
          verdicts: [{ toolName: 'list_onus', code: 'ok', reason: 'fresh', severity: 'info' }],
        };
      },
    );

    const res = await callRoute({ message: 'rx bajo' });

    expect(res.status).toBe(200);
    // DB query: must scope by tenantId AND resolvedAt >= now-90d
    expect(mocks.prismaConfirmedIncidentFindMany).toHaveBeenCalledTimes(1);
    const dbArgs = mocks.prismaConfirmedIncidentFindMany.mock.calls[0]?.[0] as {
      where: { tenantId: string; resolvedAt: { gte: Date } };
    };
    expect(dbArgs.where.tenantId).toBe('tenant-1');
    expect(dbArgs.where.resolvedAt.gte).toBeInstanceOf(Date);
    const ninetyDaysAgo = Date.now() - 90 * 86_400_000;
    expect(dbArgs.where.resolvedAt.gte.getTime()).toBeLessThanOrEqual(Date.now() - 89 * 86_400_000);
    expect(dbArgs.where.resolvedAt.gte.getTime()).toBeGreaterThanOrEqual(ninetyDaysAgo - 5000);
    // The pure-TS ranker is delegated (route stays a thin wiring shell).
    expect(mocks.retrieveRelevantIncidents).toHaveBeenCalledTimes(1);
    const rankingArgs = mocks.retrieveRelevantIncidents.mock.calls[0]?.[0] as {
      tenantId: string;
      query: string;
      confirmedIncidents: unknown[];
    };
    expect(rankingArgs.tenantId).toBe('tenant-1');
    expect(rankingArgs.query).toBe('rx bajo');
    expect(rankingArgs.confirmedIncidents).toHaveLength(1);
  });

  it('demo mode: retrievalProvider is still wired but the closure returns [] (no DB query)', async () => {
    setupHappyPath({ dataSource: fakeDemoDataSource });
    mocks.runAgent.mockImplementation(
      async (opts: { retrievalProvider?: (args: unknown) => Promise<unknown[]> }) => {
        expect(opts.retrievalProvider).toBeDefined();
        const rows = await opts.retrievalProvider!({ tenantId: 'tenant-1', query: 'demo' });
        expect(rows).toEqual([]);
        return {
          text: '[DEMO] respuesta',
          toolCalls: [okToolCall()],
          verdicts: [{ toolName: 'list_onus', code: 'ok', reason: 'fresh', severity: 'info' }],
        };
      },
    );

    const res = await callRoute({ message: 'demo' });

    expect(res.status).toBe(200);
    expect(mocks.prismaConfirmedIncidentFindMany).not.toHaveBeenCalled();
    expect(mocks.retrieveRelevantIncidents).not.toHaveBeenCalled();
    expect(mocks.prismaPendingIncidentCandidateCreate).not.toHaveBeenCalled();
  });
});

describe('POST /api/chat — PendingIncidentCandidate write gate', () => {
  it('clean run (no abstention, all verdicts ok) → exactly one PendingIncidentCandidate row with status=pending', async () => {
    mocks.runAgent.mockResolvedValueOnce({
      text: 'Reporte normal.',
      toolCalls: [
        okToolCall(),
        okToolCall({ name: 'list_olts', arguments: {}, result: '{"schema":"evidence.provenance.v1","data":[]}' }),
      ],
      verdicts: [
        { toolName: 'list_onus', code: 'ok', reason: 'fresh', severity: 'info' },
        { toolName: 'list_olts', code: 'ok', reason: 'fresh', severity: 'info' },
      ],
    });

    await callRoute({ message: 'listar' });

    expect(mocks.buildPendingIncidentCandidate).toHaveBeenCalledTimes(1);
    const builtArgs = mocks.buildPendingIncidentCandidate.mock.calls[0]?.[0] as {
      tenantId: string;
      summary: string;
      toolCallsJson: unknown;
      runSessionId?: string;
    };
    expect(builtArgs.tenantId).toBe('tenant-1');
    expect(builtArgs.summary).toBe('Reporte normal.');
    expect(builtArgs.runSessionId).toBe('conv-1');
    expect(mocks.prismaPendingIncidentCandidateCreate).toHaveBeenCalledTimes(1);
    const dbArgs = mocks.prismaPendingIncidentCandidateCreate.mock.calls[0]?.[0] as {
      data: { tenantId: string; status: string; summary: string };
    };
    expect(dbArgs.data.tenantId).toBe('tenant-1');
    expect(dbArgs.data.status).toBe('pending');
    expect(dbArgs.data.summary).toBe('Reporte normal.');
  });

  it('abstained run → zero PendingIncidentCandidate rows', async () => {
    mocks.runAgent.mockResolvedValueOnce({
      text: 'No puedo responder con la evidencia disponible.',
      toolCalls: [],
      verdicts: [
        {
          toolName: 'get_onu_detail',
          code: 'incomplete',
          reason: 'no-envelope',
          severity: 'critical',
        },
      ],
      abstention: { schema: 'ftth.abstention.v1', missing: ['get_onu_detail'] },
      abstained: true,
    });

    await callRoute({ message: 'detalle' });

    expect(mocks.buildPendingIncidentCandidate).not.toHaveBeenCalled();
    expect(mocks.prismaPendingIncidentCandidateCreate).not.toHaveBeenCalled();
  });

  it('one incomplete verdict (no abstention envelope) → zero PendingIncidentCandidate rows', async () => {
    mocks.runAgent.mockResolvedValueOnce({
      text: 'Texto devuelto (observe mode).',
      toolCalls: [okToolCall()],
      verdicts: [
        {
          toolName: 'get_onu_detail',
          code: 'incomplete',
          reason: 'no-envelope',
          severity: 'critical',
        },
      ],
      // Observe mode: text is the LLM's, no abstention override.
    });

    await callRoute({ message: 'incompleto' });

    expect(mocks.buildPendingIncidentCandidate).not.toHaveBeenCalled();
    expect(mocks.prismaPendingIncidentCandidateCreate).not.toHaveBeenCalled();
  });

  it('demo mode → zero PendingIncidentCandidate rows even when all verdicts ok', async () => {
    setupHappyPath({ dataSource: fakeDemoDataSource });
    mocks.runAgent.mockResolvedValueOnce({
      text: '[DEMO] respuesta',
      toolCalls: [okToolCall()],
      verdicts: [{ toolName: 'list_onus', code: 'ok', reason: 'fresh', severity: 'info' }],
    });

    await callRoute({ message: 'demo' });

    expect(mocks.buildPendingIncidentCandidate).not.toHaveBeenCalled();
    expect(mocks.prismaPendingIncidentCandidateCreate).not.toHaveBeenCalled();
  });
});