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
  },
}));

beforeEach(() => {
  mocks.prismaPendingIncidentCandidateFindMany.mockReset();
  mocks.prismaIncidentFindMany.mockReset();
  mocks.prismaConfirmedIncidentCreate.mockReset();
  mocks.prismaAgentActionLogCreate.mockReset();
  mocks.prismaPendingIncidentCandidateUpdate.mockReset();
  mocks.prismaConfirmedIncidentCreate.mockImplementation(({ data }) => ({ id: 'ci-1', ...data }));
  mocks.prismaAgentActionLogCreate.mockResolvedValue({ id: 'log-1' });
  mocks.prismaPendingIncidentCandidateUpdate.mockResolvedValue({ id: 'pc-1' });
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