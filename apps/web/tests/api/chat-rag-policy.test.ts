import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * RED tests for the chat-route per-tenant policy enforcement path
 * (Fase E / E-5.1 + E-5.2).
 *
 * Contract under test:
 *   1. tenantPolicy present → `runAgent` receives the resolved fields.
 *   2. tenantPolicy.truthGateMode='observe' overrides env `TRUTH_GATE_MODE=strict`
 *      via the resolved truthGateMode (per-tenant wins).
 *   3. tenantPolicy.retrievalLimit narrows the retrieval closure output (the
 *      closure forwards the knob into `retrieveRelevantIncidents`).
 *   4. tenantPolicy absent → runAgent receives tenantPolicy: undefined →
 *      Fase C/D byte-identical.
 *
 * Mirrors the discipline from `chat-rag.test.ts` (every server-only
 * dependency is replaced via `vi.mock` + `vi.hoisted`).
 */

const mocks = vi.hoisted(() => ({
  runAgent: vi.fn(),
  retrieveRelevantIncidents: vi.fn(),
  buildPendingIncidentCandidate: vi.fn(),
  loadTenantPolicy: vi.fn(),
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
  // Fase F — verdictLog persistence (F-5.2).
  prismaVerdictLogCreateMany: vi.fn(),
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

vi.mock('@/lib/policies/load-tenant-policy', () => ({
  loadTenantPolicy: mocks.loadTenantPolicy,
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

const fakeUser = {
  id: 'user-1',
  email: 'ops@isp.com',
  name: 'Ops',
  role: 'OWNER' as const,
  tenantId: 'tenant-1',
  tenant: { id: 'tenant-1', name: 'ISP', slug: 'isp' },
};

const createdConversation = { id: 'conv-1', connectionId: 'conn-1' };

const baseTenantPolicy = (overrides: Record<string, unknown> = {}) => ({
  schema: 'ftth.tenant-policy.v1' as const,
  schemaVersion: 1,
  tenantId: 'tenant-1',
  createdAt: '2026-09-01T11:00:00.000Z',
  updatedAt: '2026-09-01T11:00:00.000Z',
  ...overrides,
});

beforeEach(() => {
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
  // Fase F — verdictLog default: success.
  mocks.prismaVerdictLogCreateMany.mockReset();
  mocks.retrieveRelevantIncidents.mockReset();
  mocks.buildPendingIncidentCandidate.mockReset();
  mocks.loadTenantPolicy.mockReset();
  mocks.runAgent.mockReset();

  mocks.getCurrentUser.mockResolvedValue(fakeUser);
  mocks.hasPermission.mockReturnValue(true);
  mocks.resolveTenantConnector.mockResolvedValue({
    connector: fakeConnector,
    dataSource: fakeLiveDataSource,
  });
  mocks.consumeChatQuota.mockResolvedValue({ allowed: true, retryAfter: 0 });
  mocks.prismaConversationFindFirst.mockResolvedValue(null);
  mocks.prismaConversationCreate.mockResolvedValue(createdConversation);
  mocks.prismaMessageCreate.mockResolvedValue({ id: 'msg' });
  mocks.prismaAgentActionLogCreate.mockResolvedValue({ id: 'log' });
  mocks.prismaDetectedAlertFindMany.mockResolvedValue([]);
  mocks.prismaConfirmedIncidentFindMany.mockResolvedValue([]);
  mocks.prismaPendingIncidentCandidateCreate.mockResolvedValue({ id: 'pending-1' });
  // Default: no TenantPolicy row.
  mocks.prismaTenantPolicyFindUnique.mockResolvedValue(null);
  mocks.loadTenantPolicy.mockResolvedValue(null);
  mocks.retrieveRelevantIncidents.mockReturnValue([]);
  mocks.buildPendingIncidentCandidate.mockImplementation((args: Record<string, unknown>) => ({
    schema: 'ftth.pending-incident-candidate.v1',
    id: '',
    tenantId: args['tenantId'],
    summary: args['summary'],
    toolCallsJson: args['toolCallsJson'],
    runSessionId: args['runSessionId'],
    proposedConfirmedAt: '2026-09-01T12:00:00.000Z',
    status: 'pending',
  }));
  // Fase F — verdictLog default: success.
  mocks.prismaVerdictLogCreateMany.mockResolvedValue({ count: 0 });
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

describe('POST /api/chat — per-tenant TenantPolicy enforcement (Fase E)', () => {
  it('tenantPolicy absent → runAgent receives tenantPolicy: undefined (Fase C/D byte-identical)', async () => {
    mocks.runAgent.mockResolvedValueOnce({
      text: 'normal',
      toolCalls: [{ name: 'list_olts', arguments: {}, result: '{}' }],
      verdicts: [{ toolName: 'list_olts', code: 'ok', reason: 'fresh', severity: 'info' }],
    });

    await callRoute({ message: 'hola' });

    expect(mocks.runAgent).toHaveBeenCalledTimes(1);
    const args = mocks.runAgent.mock.calls[0]?.[0] as { tenantPolicy?: unknown };
    expect(args.tenantPolicy).toBeUndefined();
  });

  it('tenantPolicy present → runAgent receives the resolved fields verbatim', async () => {
    const policy = baseTenantPolicy({
      retrievalLimit: 7,
      retrievalSinceDays: 14,
      truthGateMode: 'observe' as const,
      abstainOnCodes: ['stale'] as const,
      promotionMinAgeMs: 60_000,
    });
    mocks.loadTenantPolicy.mockResolvedValue(policy);
    mocks.runAgent.mockResolvedValueOnce({
      text: 'normal',
      toolCalls: [{ name: 'list_olts', arguments: {}, result: '{}' }],
      verdicts: [{ toolName: 'list_olts', code: 'ok', reason: 'fresh', severity: 'info' }],
    });

    await callRoute({ message: 'hola' });

    expect(mocks.loadTenantPolicy).toHaveBeenCalledWith('tenant-1');
    const args = mocks.runAgent.mock.calls[0]?.[0] as { tenantPolicy: typeof policy | null };
    expect(args.tenantPolicy).toEqual(policy);
    expect(args.tenantPolicy && 'retrievalLimit' in args.tenantPolicy ? args.tenantPolicy.retrievalLimit : undefined).toBe(7);
    expect(args.tenantPolicy && 'truthGateMode' in args.tenantPolicy ? args.tenantPolicy.truthGateMode : undefined).toBe('observe');
  });

  it('loadTenantPolicy fires exactly once per turn (parallel with resolveTenantConnector)', async () => {
    mocks.runAgent.mockResolvedValueOnce({
      text: 'normal',
      toolCalls: [],
      verdicts: [],
    });

    await callRoute({ message: 'hola' });

    expect(mocks.loadTenantPolicy).toHaveBeenCalledTimes(1);
    expect(mocks.loadTenantPolicy).toHaveBeenCalledWith('tenant-1');
    expect(mocks.resolveTenantConnector).toHaveBeenCalledTimes(1);
  });

  it('retrievalLimit from tenantPolicy narrows the results returned by retrieveRelevantIncidents', async () => {
    const policy = baseTenantPolicy({ retrievalLimit: 2 });
    mocks.loadTenantPolicy.mockResolvedValue(policy);
    mocks.retrieveRelevantIncidents.mockReturnValue([
      {
        schema: 'ftth.confirmed-incident.v1',
        id: 'ci-1',
        tenantId: 'tenant-1',
        deviceKind: 'ONU',
        deviceId: 'onu-1',
        sourceTool: 'get_onu_detail',
        summary: 's',
        rootCause: 'r',
        fix: 'f',
        symptoms: [],
        observedAt: '2026-08-30T12:00:00.000Z',
        resolvedAt: '2026-08-30T13:00:00.000Z',
        createdAt: '2026-08-30T12:00:00.000Z',
        updatedAt: '2026-08-30T13:00:00.000Z',
        confirmedBy: 'operator',
        searchTokens: 'rx',
        score: 1,
      },
    ]);
    mocks.runAgent.mockImplementation(
      async (opts: {
        retrievalProvider?: (a: { tenantId: string; query: string }) => Promise<unknown[]>;
      }) => {
        // Invoke the closure so we can assert the args the route forwarded.
        await opts.retrievalProvider!({ tenantId: 'tenant-1', query: 'rx bajo' });
        return {
          text: 'con contexto',
          toolCalls: [{ name: 'list_olts', arguments: {}, result: '{}' }],
          verdicts: [{ toolName: 'list_olts', code: 'ok', reason: 'fresh', severity: 'info' }],
        };
      },
    );

    await callRoute({ message: 'rx bajo' });

    expect(mocks.retrieveRelevantIncidents).toHaveBeenCalledTimes(1);
    const args = mocks.retrieveRelevantIncidents.mock.calls[0]?.[0] as { limit: number };
    expect(args.limit).toBe(2);
  });

  it('per-tenant truthGateMode from tenantPolicy is forwarded to runAgent as part of opts.tenantPolicy', async () => {
    process.env['TRUTH_GATE_MODE'] = 'strict';
    const policy = baseTenantPolicy({ truthGateMode: 'observe' as const });
    mocks.loadTenantPolicy.mockResolvedValue(policy);
    mocks.runAgent.mockResolvedValueOnce({
      text: 'normal',
      toolCalls: [],
      verdicts: [],
    });

    await callRoute({ message: 'hola' });

    const args = mocks.runAgent.mock.calls[0]?.[0] as {
      mode: 'observe' | 'strict';
      tenantPolicy: { truthGateMode: 'observe' | 'strict' };
    };
    // The route still forwards `mode` from env (Fase C behavior); the per-
    // tenant override is delivered via tenantPolicy and applied inside
    // resolveTenantPolicy (the runtime consults tenantPolicy first).
    expect(args.mode).toBe('strict');
    expect(args.tenantPolicy.truthGateMode).toBe('observe');
  });
});

/**
 * Fase F — verdict_log + AgentActionLog.__injection_suspicion__ persistence
 * (F-5.2 — chat-route writes). Cross-coverage with the Fase E policy
 * suite: the warn + verdict_log writes MUST fire regardless of whether
 * the tenant policy is present (F-5.2 is policy-agnostic).
 */
describe('POST /api/chat — Fase F warn persistence + verdict_log (F-5.2 policy-aware cross-coverage)', () => {
  it('fires the __injection_suspicion__ + verdict_log writes even when a tenant policy is loaded', async () => {
    // Tenant policy with a truthGateMode override (per-tenant observe)
    // coexists with the warn path: the AgentResult.warnings field is
    // populated by the F-3 finalize branch regardless of the upstream
    // policy because warn-tier verdicts flow upstream regardless of
    // `mode`. The chat route MUST persist the warn observability on
    // every strict-mode run that returns a non-empty warnings array.
    process.env['TRUTH_GATE_MODE'] = 'strict';
    const policy = baseTenantPolicy({ retrievalLimit: 7, truthGateMode: 'observe' as const });
    mocks.loadTenantPolicy.mockResolvedValue(policy);
    mocks.runAgent.mockResolvedValueOnce({
      text: 'Reporte LLM.',
      toolCalls: [{ name: 'list_onus', arguments: {}, result: '[]' }],
      verdicts: [
        { toolName: 'list_onus', code: 'stale', reason: 'expired-ttl', severity: 'warning' },
      ],
      warnings: ['stale'],
    });

    const res = await callRoute({ message: 'policy+warn' });

    expect(res.status).toBe(200);
    const suspicionRows = mocks.prismaAgentActionLogCreate.mock.calls.filter(
      (c) =>
        (c[0] as { data: { toolName: string } }).data.toolName ===
        '__injection_suspicion__',
    );
    expect(suspicionRows).toHaveLength(1);
    expect(
      (suspicionRows[0]![0] as { data: { parameters: unknown } }).data.parameters,
    ).toEqual({ mode: 'strict', warnCodes: ['stale'] });

    expect(mocks.prismaVerdictLogCreateMany).toHaveBeenCalledTimes(1);
    const entries = (mocks.prismaVerdictLogCreateMany.mock.calls[0]?.[0] as {
      data: Array<Record<string, unknown>>;
    }).data;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      tenantId: 'tenant-1',
      code: 'stale',
      injectionSuspicion: true,
    });
  });
});