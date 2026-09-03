import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * RED tests for the operator confirm route at
 * `apps/web/app/api/incidents/[id]/confirm/route.ts` (WU4 / D-4.1).
 *
 * Contract under test:
 *  1. POST is gated on `view_network` — 403 without it (zero writes).
 *  2. Body is zod-validated (`rootCause`, `fix`, `summary` all ≥1 char);
 *     a missing field returns 400.
 *  3. Unknown incident id → 404.
 *  4. Incident not yet resolved → 409.
 *  5. Happy path: writes 1 `ConfirmedIncident` (`confirmedBy: 'operator'`,
 *     `confirmedByUserId: user.id`) + 1 `AgentActionLog`
 *     (`toolName: '__operator_confirm__'`, `parameters: { rootCause, fix, summary }`,
 *     `result: confirmedIncident.id`) and returns 201.
 *  6. Idempotent retry: a second POST returns 200 with the existing row and
 *     writes NO new rows.
 *  7. `searchTokens` on the inserted ConfirmedIncident is the lowercase,
 *     deduped, stop-word-trimmed tokenization of `${rootCause} ${fix} ${summary}`.
 *
 * Mocking pattern mirrors `apps/web/tests/api/chat-abstention.test.ts` —
 * every server-only dependency is replaced via `vi.mock` + `vi.hoisted`.
 */

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  hasPermission: vi.fn(),
  prismaIncidentFindFirst: vi.fn(),
  prismaConfirmedIncidentFindFirst: vi.fn(),
  prismaConfirmedIncidentCreate: vi.fn(),
  prismaAgentActionLogCreate: vi.fn(),
}));

vi.mock('@/lib/auth/server', () => ({
  getCurrentUser: mocks.getCurrentUser,
}));

vi.mock('@/lib/auth/permissions', () => ({
  hasPermission: mocks.hasPermission,
}));

vi.mock('@ftth-copilot/db', () => ({
  prisma: {
    incident: {
      findFirst: mocks.prismaIncidentFindFirst,
    },
    confirmedIncident: {
      findFirst: mocks.prismaConfirmedIncidentFindFirst,
      create: mocks.prismaConfirmedIncidentCreate,
    },
    agentActionLog: {
      create: mocks.prismaAgentActionLogCreate,
    },
  },
}));

const fakeUser = {
  id: 'user-1',
  email: 'ops@isp.com',
  name: 'Ops',
  role: 'OPERATOR' as const,
  tenantId: 'tenant-1',
  tenant: { id: 'tenant-1', name: 'ISP', slug: 'isp' },
};

const RESOLVED_INCIDENT = {
  id: 'inc-1',
  tenantId: 'tenant-1',
  deviceKind: 'ONU',
  deviceId: 'onu-1',
  status: 'resolved',
  resolvedAt: new Date('2026-09-01T12:00:00.000Z'),
  observedAt: new Date('2026-09-01T08:00:00.000Z'),
};

function resetMocks() {
  mocks.getCurrentUser.mockReset();
  mocks.hasPermission.mockReset();
  mocks.prismaIncidentFindFirst.mockReset();
  mocks.prismaConfirmedIncidentFindFirst.mockReset();
  mocks.prismaConfirmedIncidentCreate.mockReset();
  mocks.prismaAgentActionLogCreate.mockReset();
  // Default: no existing confirmation; route writes a new one.
  mocks.prismaConfirmedIncidentFindFirst.mockResolvedValue(null);
  mocks.prismaConfirmedIncidentCreate.mockImplementation(({ data }) => ({
    id: 'ci-1',
    ...data,
  }));
  mocks.prismaAgentActionLogCreate.mockImplementation(({ data }) => ({ id: 'log-1', ...data }));
  mocks.prismaIncidentFindFirst.mockResolvedValue(RESOLVED_INCIDENT);
}

beforeEach(() => {
  resetMocks();
  mocks.getCurrentUser.mockResolvedValue(fakeUser);
  mocks.hasPermission.mockReturnValue(true);
});

afterEach(() => {
  vi.clearAllMocks();
});

async function callRoute(
  id: string,
  body: unknown,
): Promise<Response> {
  const { POST } = await import('@/app/api/incidents/[id]/confirm/route');
  const req = new Request(`http://localhost/api/incidents/${id}/confirm`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return POST(req as unknown as Parameters<typeof POST>[0], {
    params: Promise.resolve({ id }),
  });
}

const validBody = { rootCause: 'Conector sucio', fix: 'Limpieza', summary: 'RX bajo ONU-1' };

describe('POST /api/incidents/:id/confirm — permission gate', () => {
  it('returns 403 when the user lacks view_network (zero writes)', async () => {
    mocks.hasPermission.mockReturnValue(false);
    const res = await callRoute('inc-1', validBody);
    expect(res.status).toBe(403);
    expect(mocks.prismaIncidentFindFirst).not.toHaveBeenCalled();
    expect(mocks.prismaConfirmedIncidentCreate).not.toHaveBeenCalled();
    expect(mocks.prismaAgentActionLogCreate).not.toHaveBeenCalled();
  });
});

describe('POST /api/incidents/:id/confirm — input validation', () => {
  it('returns 400 when rootCause is empty (zod rejection, no DB query)', async () => {
    const res = await callRoute('inc-1', { ...validBody, rootCause: '' });
    expect(res.status).toBe(400);
    expect(mocks.prismaIncidentFindFirst).not.toHaveBeenCalled();
  });

  it('returns 400 when fix is missing', async () => {
    const res = await callRoute('inc-1', { rootCause: 'x', summary: 'y' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when summary is missing', async () => {
    const res = await callRoute('inc-1', { rootCause: 'x', fix: 'y' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/incidents/:id/confirm — incident lookup', () => {
  it('returns 404 when the incident does not exist for this tenant', async () => {
    mocks.prismaIncidentFindFirst.mockResolvedValue(null);
    const res = await callRoute('inc-missing', validBody);
    expect(res.status).toBe(404);
    expect(mocks.prismaConfirmedIncidentCreate).not.toHaveBeenCalled();
  });

  it('returns 409 when the incident is not yet resolved', async () => {
    mocks.prismaIncidentFindFirst.mockResolvedValue({
      ...RESOLVED_INCIDENT,
      status: 'open',
    });
    const res = await callRoute('inc-1', validBody);
    expect(res.status).toBe(409);
    expect(mocks.prismaConfirmedIncidentCreate).not.toHaveBeenCalled();
  });
});

describe('POST /api/incidents/:id/confirm — happy path', () => {
  it('writes 1 ConfirmedIncident + 1 AgentActionLog with the operator identity', async () => {
    const res = await callRoute('inc-1', validBody);
    expect(res.status).toBe(201);

    expect(mocks.prismaConfirmedIncidentCreate).toHaveBeenCalledTimes(1);
    const ciArgs = mocks.prismaConfirmedIncidentCreate.mock.calls[0]?.[0] as {
      data: {
        tenantId: string;
        sourceIncidentId: string;
        confirmedBy: string;
        confirmedByUserId: string;
        sourceTool: string;
        searchTokens: string;
      };
    };
    expect(ciArgs.data.tenantId).toBe('tenant-1');
    expect(ciArgs.data.sourceIncidentId).toBe('inc-1');
    expect(ciArgs.data.confirmedBy).toBe('operator');
    expect(ciArgs.data.confirmedByUserId).toBe('user-1');
    expect(ciArgs.data.sourceTool).toBe('__operator_confirm__');

    expect(mocks.prismaAgentActionLogCreate).toHaveBeenCalledTimes(1);
    const logArgs = mocks.prismaAgentActionLogCreate.mock.calls[0]?.[0] as {
      data: {
        tenantId: string;
        toolName: string;
        parameters: { rootCause: string; fix: string; summary: string };
        result: string;
      };
    };
    expect(logArgs.data.tenantId).toBe('tenant-1');
    expect(logArgs.data.toolName).toBe('__operator_confirm__');
    expect(logArgs.data.parameters).toEqual(validBody);
    expect(logArgs.data.result).toBe('ci-1');
  });

  it('computes searchTokens as lowercase + deduped + stop-word-trimmed tokens', async () => {
    await callRoute('inc-1', {
      rootCause: 'Conector sucio en la ONU',
      fix: 'Limpieza del conector',
      summary: 'RX bajo ONU-1 la la la',
    });
    const ciArgs = mocks.prismaConfirmedIncidentCreate.mock.calls[0]?.[0] as {
      data: { searchTokens: string };
    };
    // The persisted column is the precomputed token string (whitespace-separated);
    // lowercase + dedup + sorted + stop-word drop are locked by `tokenize` in @ftth-copilot/evidence.
    // `en`, `la`, `del` are stop-words. `ONU-1` is split into `onu` and `1` by the tokenizer regex.
    expect(ciArgs.data.searchTokens).toBe(
      '1 bajo conector limpieza onu rx sucio',
    );
  });
});

describe('POST /api/incidents/:id/confirm — idempotency', () => {
  it('returns 200 with the existing row and writes zero new rows on retry', async () => {
    const existing = {
      id: 'ci-existing',
      tenantId: 'tenant-1',
      sourceIncidentId: 'inc-1',
      confirmedBy: 'operator',
      confirmedByUserId: 'user-1',
    };
    mocks.prismaConfirmedIncidentFindFirst.mockResolvedValue(existing);

    const res = await callRoute('inc-1', validBody);

    expect(res.status).toBe(200);
    expect(mocks.prismaConfirmedIncidentCreate).not.toHaveBeenCalled();
    expect(mocks.prismaAgentActionLogCreate).not.toHaveBeenCalled();
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe('ci-existing');
  });
});