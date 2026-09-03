import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * RED tests for `promotePendingIncidents(now)` at
 * `apps/web/lib/promote-pending-incidents.ts` (WU4 / D-5.1).
 *
 * Contract under test:
 *  1. No pending candidates → `{ promoted: 0, skipped: 0 }`, zero writes.
 *  2. Eligible candidate (resolved ≥24h, no incomplete verdict) →
 *     `{ promoted: 1, skipped: 0 }` and exactly one `ConfirmedIncident`
 *     (`confirmedBy: 'agent'`) + one `AgentActionLog`
 *     (`toolName: '__agent_promote__'`).
 *  3. Incident still resolving (resolved < 24h ago) → skipped.
 *  4. Incident still open (status !== 'resolved') → skipped.
 *  5. Originating run had an `incomplete` verdict → skipped.
 *  6. Idempotent: re-running with no `status === 'pending'` candidates
 *     promotes zero.
 *
 * `@ftth-copilot/db` is mocked; `@ftth-copilot/evidence` runs the real
 * `eligibleForPromotion` so the eligibility contract is exercised end-to-end.
 */

const mocks = vi.hoisted(() => ({
  prismaPendingIncidentCandidateFindMany: vi.fn(),
  prismaIncidentFindMany: vi.fn(),
  prismaConfirmedIncidentCreate: vi.fn(),
  prismaAgentActionLogCreate: vi.fn(),
  prismaPendingIncidentCandidateUpdate: vi.fn(),
  prismaTenantPolicyFindMany: vi.fn(),
}));

vi.mock('@ftth-copilot/db', () => ({
  prisma: {
    pendingIncidentCandidate: {
      findMany: mocks.prismaPendingIncidentCandidateFindMany,
      update: mocks.prismaPendingIncidentCandidateUpdate,
    },
    incident: {
      findMany: mocks.prismaIncidentFindMany,
    },
    confirmedIncident: {
      create: mocks.prismaConfirmedIncidentCreate,
    },
    agentActionLog: {
      create: mocks.prismaAgentActionLogCreate,
    },
    tenantPolicy: {
      findMany: mocks.prismaTenantPolicyFindMany,
    },
  },
}));

beforeEach(() => {
  mocks.prismaPendingIncidentCandidateFindMany.mockReset();
  mocks.prismaIncidentFindMany.mockReset();
  mocks.prismaConfirmedIncidentCreate.mockReset();
  mocks.prismaAgentActionLogCreate.mockReset();
  mocks.prismaPendingIncidentCandidateUpdate.mockReset();
  mocks.prismaTenantPolicyFindMany.mockReset();
  mocks.prismaConfirmedIncidentCreate.mockImplementation(({ data }) => ({ id: 'ci-1', ...data }));
  mocks.prismaAgentActionLogCreate.mockResolvedValue({ id: 'log-1' });
  mocks.prismaPendingIncidentCandidateUpdate.mockResolvedValue({ id: 'pc-1' });
  mocks.prismaTenantPolicyFindMany.mockResolvedValue([]);
});

afterEach(() => {
  vi.clearAllMocks();
});

const NOW = new Date('2026-09-01T12:00:00.000Z');
const HOUR_MS = 3_600_000;

function hoursAgo(hours: number): Date {
  return new Date(NOW.getTime() - hours * HOUR_MS);
}

describe('promotePendingIncidents — eligibility gate', () => {
  it('returns {promoted:0, skipped:0} when there are no pending candidates', async () => {
    mocks.prismaPendingIncidentCandidateFindMany.mockResolvedValue([]);
    const { promotePendingIncidents } = await import('@/lib/promote-pending-incidents');
    const result = await promotePendingIncidents(NOW);
    expect(result).toEqual({ promoted: 0, skipped: 0 });
    expect(mocks.prismaConfirmedIncidentCreate).not.toHaveBeenCalled();
  });

  it('promotes one candidate whose incident resolved ≥24h ago with no incomplete verdict', async () => {
    mocks.prismaPendingIncidentCandidateFindMany.mockResolvedValue([
      {
        id: 'pc-1',
        tenantId: 'tenant-1',
        sourceIncidentId: 'inc-1',
        summary: 'RX bajo ONU-1',
        toolCallsJson: [{ toolName: 'get_onu_detail', code: 'ok' }],
        runSessionId: 'conv-1',
        proposedConfirmedAt: hoursAgo(48),
        status: 'pending',
      },
    ]);
    mocks.prismaIncidentFindMany.mockResolvedValue([
      {
        id: 'inc-1',
        tenantId: 'tenant-1',
        deviceKind: 'ONU',
        deviceId: 'onu-1',
        status: 'resolved',
        resolvedAt: hoursAgo(25),
      },
    ]);

    const { promotePendingIncidents } = await import('@/lib/promote-pending-incidents');
    const result = await promotePendingIncidents(NOW);
    expect(result).toEqual({ promoted: 1, skipped: 0 });
    expect(mocks.prismaConfirmedIncidentCreate).toHaveBeenCalledTimes(1);
    const ciArgs = mocks.prismaConfirmedIncidentCreate.mock.calls[0]?.[0] as {
      data: { confirmedBy: string; sourceTool: string; tenantId: string };
    };
    expect(ciArgs.data.confirmedBy).toBe('agent');
    expect(ciArgs.data.sourceTool).toBe('__agent_promote__');
    expect(ciArgs.data.tenantId).toBe('tenant-1');

    expect(mocks.prismaAgentActionLogCreate).toHaveBeenCalledTimes(1);
    const logArgs = mocks.prismaAgentActionLogCreate.mock.calls[0]?.[0] as {
      data: { toolName: string; result: string };
    };
    expect(logArgs.data.toolName).toBe('__agent_promote__');
    expect(logArgs.data.result).toBe('ci-1');

    expect(mocks.prismaPendingIncidentCandidateUpdate).toHaveBeenCalledWith({
      where: { id: 'pc-1' },
      data: { status: 'promoted' },
    });
  });

  it('skips a candidate whose incident resolved less than 24h ago', async () => {
    mocks.prismaPendingIncidentCandidateFindMany.mockResolvedValue([
      {
        id: 'pc-1',
        tenantId: 'tenant-1',
        sourceIncidentId: 'inc-1',
        summary: 'RX bajo ONU-1',
        toolCallsJson: [{ code: 'ok' }],
        runSessionId: 'conv-1',
        proposedConfirmedAt: hoursAgo(13),
        status: 'pending',
      },
    ]);
    mocks.prismaIncidentFindMany.mockResolvedValue([
      {
        id: 'inc-1',
        tenantId: 'tenant-1',
        deviceKind: 'ONU',
        deviceId: 'onu-1',
        status: 'resolved',
        resolvedAt: hoursAgo(12),
      },
    ]);

    const { promotePendingIncidents } = await import('@/lib/promote-pending-incidents');
    const result = await promotePendingIncidents(NOW);
    expect(result).toEqual({ promoted: 0, skipped: 1 });
    expect(mocks.prismaConfirmedIncidentCreate).not.toHaveBeenCalled();
  });

  it('skips a candidate whose incident is still open', async () => {
    mocks.prismaPendingIncidentCandidateFindMany.mockResolvedValue([
      {
        id: 'pc-1',
        tenantId: 'tenant-1',
        sourceIncidentId: 'inc-1',
        summary: 'RX bajo',
        toolCallsJson: [{ code: 'ok' }],
        runSessionId: 'conv-1',
        proposedConfirmedAt: hoursAgo(48),
        status: 'pending',
      },
    ]);
    mocks.prismaIncidentFindMany.mockResolvedValue([
      {
        id: 'inc-1',
        tenantId: 'tenant-1',
        deviceKind: 'ONU',
        deviceId: 'onu-1',
        status: 'open',
        resolvedAt: null,
      },
    ]);

    const { promotePendingIncidents } = await import('@/lib/promote-pending-incidents');
    const result = await promotePendingIncidents(NOW);
    expect(result).toEqual({ promoted: 0, skipped: 1 });
    expect(mocks.prismaConfirmedIncidentCreate).not.toHaveBeenCalled();
  });

  it('skips a candidate whose originating run had an incomplete verdict', async () => {
    mocks.prismaPendingIncidentCandidateFindMany.mockResolvedValue([
      {
        id: 'pc-1',
        tenantId: 'tenant-1',
        sourceIncidentId: 'inc-1',
        summary: 'RX bajo',
        toolCallsJson: [{ toolName: 'get_onu_detail', code: 'incomplete' }],
        runSessionId: 'conv-1',
        proposedConfirmedAt: hoursAgo(48),
        status: 'pending',
      },
    ]);
    mocks.prismaIncidentFindMany.mockResolvedValue([
      {
        id: 'inc-1',
        tenantId: 'tenant-1',
        deviceKind: 'ONU',
        deviceId: 'onu-1',
        status: 'resolved',
        resolvedAt: hoursAgo(25),
      },
    ]);

    const { promotePendingIncidents } = await import('@/lib/promote-pending-incidents');
    const result = await promotePendingIncidents(NOW);
    expect(result).toEqual({ promoted: 0, skipped: 1 });
    expect(mocks.prismaConfirmedIncidentCreate).not.toHaveBeenCalled();
  });

  it('idempotent: re-running with no pending candidates promotes zero', async () => {
    mocks.prismaPendingIncidentCandidateFindMany.mockResolvedValue([]);
    const { promotePendingIncidents } = await import('@/lib/promote-pending-incidents');
    const result = await promotePendingIncidents(NOW);
    expect(result).toEqual({ promoted: 0, skipped: 0 });
    expect(mocks.prismaConfirmedIncidentCreate).not.toHaveBeenCalled();
  });
});

// ── Fase E — per-tenant promotionMinAgeMs (policyLoader 2nd arg) ─────────────

describe('promotePendingIncidents — Fase E per-tenant policyLoader', () => {
  const policyFor = (
    overrides: Record<string, unknown>,
  ): {
    schema: 'ftth.tenant-policy.v1';
    schemaVersion: 1;
    tenantId: string;
    [k: string]: unknown;
  } => ({
    schema: 'ftth.tenant-policy.v1',
    schemaVersion: 1,
    tenantId: 'tenant-1',
    ...overrides,
  });

  function setupCandidates(
    candidates: Array<{ id: string; tenantId: string; hoursAgo: number }>,
  ): void {
    mocks.prismaPendingIncidentCandidateFindMany.mockResolvedValue(
      candidates.map((c) => ({
        id: c.id,
        tenantId: c.tenantId,
        sourceIncidentId: `inc-${c.id}`,
        summary: 'RX bajo',
        toolCallsJson: [{ toolName: 'get_onu_detail', code: 'ok' }],
        runSessionId: 'conv-1',
        proposedConfirmedAt: hoursAgo(c.hoursAgo),
        status: 'pending',
      })),
    );
    mocks.prismaIncidentFindMany.mockResolvedValue(
      candidates.map((c) => ({
        id: `inc-${c.id}`,
        tenantId: c.tenantId,
        deviceKind: 'ONU',
        deviceId: 'onu-1',
        status: 'resolved',
        resolvedAt: hoursAgo(c.hoursAgo),
      })),
    );
  }

  it('absent policyLoader → Fase D 24h baseline (per-tenant override never applies)', async () => {
    setupCandidates([{ id: 'pc-1', tenantId: 'tenant-1', hoursAgo: 25 }]);
    const { promotePendingIncidents } = await import('@/lib/promote-pending-incidents');
    const result = await promotePendingIncidents(NOW);
    expect(result).toEqual({ promoted: 1, skipped: 0 });
    expect(mocks.prismaTenantPolicyFindMany).not.toHaveBeenCalled();
  });

  it('per-tenant promotionMinAgeMs: 60_000 (1min) promotes a 5-minute-old candidate', async () => {
    setupCandidates([{ id: 'pc-1', tenantId: 'tenant-1', hoursAgo: 0.083 }]); // ~5 min
    const { promotePendingIncidents } = await import('@/lib/promote-pending-incidents');
    const result = await promotePendingIncidents(NOW, async () =>
      new Map([['tenant-1', policyFor({ promotionMinAgeMs: 60_000 })]]),
    );
    expect(result).toEqual({ promoted: 1, skipped: 0 });
  });

  it('per-tenant promotionMinAgeMs: 259_200_000 (72h) blocks a 25h-old candidate', async () => {
    setupCandidates([{ id: 'pc-1', tenantId: 'tenant-1', hoursAgo: 25 }]);
    const { promotePendingIncidents } = await import('@/lib/promote-pending-incidents');
    const result = await promotePendingIncidents(NOW, async () =>
      new Map([['tenant-1', policyFor({ promotionMinAgeMs: 259_200_000 })]]),
    );
    expect(result).toEqual({ promoted: 0, skipped: 1 });
  });

  it('per-tenant promotionMinAgeMs: 0 promotes immediately', async () => {
    setupCandidates([{ id: 'pc-1', tenantId: 'tenant-1', hoursAgo: 0 }]);
    const { promotePendingIncidents } = await import('@/lib/promote-pending-incidents');
    const result = await promotePendingIncidents(NOW, async () =>
      new Map([['tenant-1', policyFor({ promotionMinAgeMs: 0 })]]),
    );
    expect(result).toEqual({ promoted: 1, skipped: 0 });
  });

  it('10 candidates across 4 tenants → exactly ONE policyLoader call (batched Map, no N+1)', async () => {
    setupCandidates([
      { id: 'pc-1', tenantId: 't1', hoursAgo: 25 },
      { id: 'pc-2', tenantId: 't2', hoursAgo: 25 },
      { id: 'pc-3', tenantId: 't3', hoursAgo: 25 },
      { id: 'pc-4', tenantId: 't4', hoursAgo: 25 },
      { id: 'pc-5', tenantId: 't1', hoursAgo: 25 },
      { id: 'pc-6', tenantId: 't2', hoursAgo: 25 },
      { id: 'pc-7', tenantId: 't3', hoursAgo: 25 },
      { id: 'pc-8', tenantId: 't4', hoursAgo: 25 },
      { id: 'pc-9', tenantId: 't1', hoursAgo: 25 },
      { id: 'pc-10', tenantId: 't2', hoursAgo: 25 },
    ]);
    const policyLoader = vi.fn(
      async (tenantIds: ReadonlyArray<string>) =>
        new Map(tenantIds.map((t) => [t, policyFor({ tenantId: t })])),
    );
    const { promotePendingIncidents } = await import('@/lib/promote-pending-incidents');
    const result = await promotePendingIncidents(NOW, policyLoader);
    expect(result.promoted).toBe(10);
    expect(policyLoader).toHaveBeenCalledTimes(1);
    // The single call must receive the deduped tenantIds list.
    expect(policyLoader.mock.calls[0]?.[0].sort()).toEqual(['t1', 't2', 't3', 't4']);
  });

  it('mixed scenario: some tenants have a policy, others use the 24h default', async () => {
    setupCandidates([
      { id: 'pc-1', tenantId: 'fast', hoursAgo: 0.083 }, // 5min
      { id: 'pc-2', tenantId: 'slow', hoursAgo: 25 }, // resolved 25h ago, slow policy requires 72h
      { id: 'pc-3', tenantId: 'default', hoursAgo: 25 }, // resolved 25h ago, no policy → 24h passes
    ]);
    const { promotePendingIncidents } = await import('@/lib/promote-pending-incidents');
    const result = await promotePendingIncidents(NOW, async () =>
      new Map([
        ['fast', policyFor({ tenantId: 'fast', promotionMinAgeMs: 60_000 })],
        ['slow', policyFor({ tenantId: 'slow', promotionMinAgeMs: 259_200_000 })],
      ]),
    );
    // fast (5min > 1min) → promoted; slow (25h < 72h) → skipped; default (25h > 24h) → promoted
    expect(result).toEqual({ promoted: 2, skipped: 1 });
  });

  it('no candidates → policyLoader is not invoked', async () => {
    mocks.prismaPendingIncidentCandidateFindMany.mockResolvedValue([]);
    const policyLoader = vi.fn(async () => new Map());
    const { promotePendingIncidents } = await import('@/lib/promote-pending-incidents');
    await promotePendingIncidents(NOW, policyLoader);
    expect(policyLoader).not.toHaveBeenCalled();
  });
});