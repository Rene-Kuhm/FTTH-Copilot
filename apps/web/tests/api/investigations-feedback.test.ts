import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * RED tests for
 *   apps/web/app/api/investigations/[runId]/versions/[versionId]/feedback/route.ts
 *
 * Contract under test:
 *  1. POST is gated on `view_network` — 403 without it (zero writes).
 *  2. Body is zod-validated: label MUST be one of the three closed
 *     values; missing label → 400.
 *  3. Unknown runId in caller tenant → 404 (NOT 403, to avoid leaking
 *     existence across tenants).
 *  4. Unknown versionId for the run → 404.
 *  5. Idempotent retry: a second POST with the same
 *     (tenantId, runId, versionId, authorUserId, label) tuple returns
 *     200 with `idempotent: true` and the existing row's feedbackId,
 *     and writes no new rows.
 *  6. Different labels produce different rows for the same author/version
 *     (history preserved).
 *  7. AgentActionLog entry is written on a fresh insert with the
 *     audit-friendly toolName '__investigation_feedback__'.
 *  8. Body bytes > 4 KiB are clamped via clampFreeText helper before
 *     write so a malicious technician cannot bloat the row.
 */

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  hasPermission: vi.fn(),
  prismaRunFindFirst: vi.fn(),
  prismaVersionFindFirst: vi.fn(),
  prismaFeedbackFindFirst: vi.fn(),
  prismaFeedbackCreate: vi.fn(),
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
    investigationRun: {
      findFirst: mocks.prismaRunFindFirst,
    },
    investigationVersion: {
      findFirst: mocks.prismaVersionFindFirst,
    },
    investigationFeedback: {
      findFirst: mocks.prismaFeedbackFindFirst,
      create: mocks.prismaFeedbackCreate,
    },
    agentActionLog: {
      create: mocks.prismaAgentActionLogCreate,
    },
  },
  Prisma: {
    PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error {
      readonly code = 'P2002';
    },
  },
}));

const fakeUserA = {
  id: 'user-a',
  email: 'a@isp.com',
  name: 'A',
  role: 'OPERATOR' as const,
  tenantId: 'tenant-a',
  tenant: { id: 'tenant-a', name: 'A', slug: 'a' },
};

const RUN = { id: 'run-row-1', runId: 'r_1', status: 'pending' };
const VERSION = { id: 'ver-row-1', versionId: 'v_1', runRefId: 'run-row-1' };

function resetMocks() {
  mocks.getCurrentUser.mockReset();
  mocks.hasPermission.mockReset();
  mocks.prismaRunFindFirst.mockReset();
  mocks.prismaVersionFindFirst.mockReset();
  mocks.prismaFeedbackFindFirst.mockReset();
  mocks.prismaFeedbackCreate.mockReset();
  mocks.prismaAgentActionLogCreate.mockReset();
  // Default: run exists, version exists, no prior feedback.
  mocks.prismaRunFindFirst.mockResolvedValue(RUN);
  mocks.prismaVersionFindFirst.mockResolvedValue(VERSION);
  mocks.prismaFeedbackFindFirst.mockResolvedValue(null);
  mocks.prismaFeedbackCreate.mockImplementation(({ data }) => ({
    feedbackId: data.feedbackId,
    runId: data.runId,
    versionId: data.versionId,
    label: data.label,
    observations: data.observations,
    realCause: data.realCause,
    resolutionEvidence: data.resolutionEvidence,
    authorUserId: data.authorUserId,
    submittedAt: new Date('2026-09-07T10:00:00.000Z'),
  }));
  mocks.prismaAgentActionLogCreate.mockImplementation(({ data }) => ({ id: 'log-1', ...data }));
}

beforeEach(() => {
  resetMocks();
  mocks.getCurrentUser.mockResolvedValue(fakeUserA);
  mocks.hasPermission.mockReturnValue(true);
});

afterEach(() => {
  vi.clearAllMocks();
});

async function callRoute(
  runId: string,
  versionId: string,
  body: unknown,
): Promise<Response> {
  const { POST } = await import(
    '@/app/api/investigations/[runId]/versions/[versionId]/feedback/route'
  );
  const req = new Request(
    `http://localhost/api/investigations/${runId}/versions/${versionId}/feedback`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  return POST(req as unknown as Parameters<typeof POST>[0], {
    params: Promise.resolve({ runId, versionId }),
  });
}

const validBody = { label: 'confirmed' as const };

describe('POST /api/investigations/:runId/versions/:versionId/feedback — permission gate', () => {
  it('returns 403 when the user lacks view_network (zero writes)', async () => {
    mocks.hasPermission.mockReturnValue(false);
    const res = await callRoute('r_1', 'v_1', validBody);
    expect(res.status).toBe(403);
    expect(mocks.prismaRunFindFirst).not.toHaveBeenCalled();
    expect(mocks.prismaVersionFindFirst).not.toHaveBeenCalled();
    expect(mocks.prismaFeedbackCreate).not.toHaveBeenCalled();
    expect(mocks.prismaAgentActionLogCreate).not.toHaveBeenCalled();
  });

  it('returns 401 when there is no authenticated user', async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    const res = await callRoute('r_1', 'v_1', validBody);
    expect(res.status).toBe(401);
  });
});

describe('POST /api/investigations/:runId/versions/:versionId/feedback — input validation', () => {
  it('returns 400 when label is missing', async () => {
    const res = await callRoute('r_1', 'v_1', {});
    expect(res.status).toBe(400);
    expect(mocks.prismaFeedbackCreate).not.toHaveBeenCalled();
  });

  it('returns 400 when label is the (yet-undeclared) maintenance value', async () => {
    const res = await callRoute('r_1', 'v_1', { label: 'maintenance' });
    expect(res.status).toBe(400);
    expect(mocks.prismaFeedbackCreate).not.toHaveBeenCalled();
  });

  it('returns 400 when the body is not JSON', async () => {
    const { POST } = await import(
      '@/app/api/investigations/[runId]/versions/[versionId]/feedback/route'
    );
    const req = new Request(
      'http://localhost/api/investigations/r_1/versions/v_1/feedback',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'not-json',
      },
    );
    const res = await POST(req as unknown as Parameters<typeof POST>[0], {
      params: Promise.resolve({ runId: 'r_1', versionId: 'v_1' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/investigations/:runId/versions/:versionId/feedback — tenant scoping', () => {
  it('returns 404 when the runId does not exist for this tenant', async () => {
    mocks.prismaRunFindFirst.mockResolvedValue(null);
    const res = await callRoute('r_foreign', 'v_1', validBody);
    expect(res.status).toBe(404);
    expect(mocks.prismaFeedbackCreate).not.toHaveBeenCalled();
  });

  it('returns 404 when the versionId does not exist for this run', async () => {
    mocks.prismaVersionFindFirst.mockResolvedValue(null);
    const res = await callRoute('r_1', 'v_foreign', validBody);
    expect(res.status).toBe(404);
    expect(mocks.prismaFeedbackCreate).not.toHaveBeenCalled();
  });
});

describe('POST /api/investigations/:runId/versions/:versionId/feedback — happy path', () => {
  it('writes 1 feedback row + 1 AgentActionLog with the audit-friendly toolName', async () => {
    const res = await callRoute('r_1', 'v_1', validBody);
    expect(res.status).toBe(201);

    expect(mocks.prismaFeedbackCreate).toHaveBeenCalledTimes(1);
    const args = mocks.prismaFeedbackCreate.mock.calls[0]?.[0] as {
      data: {
        tenantId: string;
        runId: string;
        versionId: string;
        label: string;
        authorUserId: string;
        runRefId: string;
        versionRefId: string;
        observations: string | null;
        realCause: string | null;
      };
    };
    expect(args.data.tenantId).toBe('tenant-a');
    expect(args.data.runId).toBe('r_1');
    expect(args.data.versionId).toBe('v_1');
    expect(args.data.label).toBe('confirmed');
    expect(args.data.authorUserId).toBe('user-a');
    expect(args.data.runRefId).toBe('run-row-1');
    expect(args.data.versionRefId).toBe('ver-row-1');

    expect(mocks.prismaAgentActionLogCreate).toHaveBeenCalledTimes(1);
    const logArgs = mocks.prismaAgentActionLogCreate.mock.calls[0]?.[0] as {
      data: {
        tenantId: string;
        userId: string;
        toolName: string;
        parameters: { runId: string; versionId: string; feedbackId: string; label: string };
        result: string;
      };
    };
    expect(logArgs.data.toolName).toBe('__investigation_feedback__');
    expect(logArgs.data.toolName).not.toMatch(/[<>]/);
    expect(logArgs.data.parameters.runId).toBe('r_1');
    expect(logArgs.data.parameters.label).toBe('confirmed');

    const body = (await res.json()) as {
      idempotent: boolean;
      idempotencyKey: string;
      feedbackId: string;
    };
    expect(body.idempotent).toBe(false);
    expect(body.idempotencyKey).toBe('tenant-a\u0001r_1\u0001v_1\u0001user-a\u0001confirmed');
    expect(body.feedbackId).toMatch(/^f_[0-9a-f]{32}$/);
  });

  it('clamps the observations field to 4 KiB before write', async () => {
    const huge = 'a'.repeat(8 * 1024);
    await callRoute('r_1', 'v_1', { label: 'confirmed', observations: huge });
    const args = mocks.prismaFeedbackCreate.mock.calls[0]?.[0] as {
      data: { observations: string | null };
    };
    expect(args.data.observations).not.toBeNull();
    expect(new TextEncoder().encode(args.data.observations ?? '').byteLength).toBe(4 * 1024);
  });

  it('nulls empty / whitespace observations rather than storing them', async () => {
    await callRoute('r_1', 'v_1', { label: 'incorrect', observations: '   \n  ' });
    const args = mocks.prismaFeedbackCreate.mock.calls[0]?.[0] as {
      data: { observations: string | null };
    };
    expect(args.data.observations).toBeNull();
  });

  it('accepts all three closed labels (confirmed, incorrect, insufficient_data)', async () => {
    for (const label of ['confirmed', 'incorrect', 'insufficient_data'] as const) {
      mocks.prismaFeedbackFindFirst.mockResolvedValue(null);
      mocks.prismaFeedbackCreate.mockClear();
      mocks.prismaAgentActionLogCreate.mockClear();
      const res = await callRoute('r_1', 'v_1', { label });
      expect(res.status).toBe(201);
      const args = mocks.prismaFeedbackCreate.mock.calls[0]?.[0] as {
        data: { label: string };
      };
      expect(args.data.label).toBe(label);
    }
  });
});

describe('POST /api/investigations/:runId/versions/:versionId/feedback — idempotency', () => {
  it('returns 200 with the existing row and writes zero new rows on retry', async () => {
    const existing = {
      feedbackId: 'f_existing',
      runId: 'r_1',
      versionId: 'v_1',
      label: 'confirmed',
      observations: null,
      realCause: null,
      resolutionEvidence: null,
      authorUserId: 'user-a',
      submittedAt: new Date('2026-09-07T09:00:00.000Z'),
    };
    mocks.prismaFeedbackFindFirst.mockResolvedValue(existing);

    const res = await callRoute('r_1', 'v_1', validBody);
    expect(res.status).toBe(200);
    expect(mocks.prismaFeedbackCreate).not.toHaveBeenCalled();
    expect(mocks.prismaAgentActionLogCreate).not.toHaveBeenCalled();

    const body = (await res.json()) as {
      feedbackId: string;
      idempotent: boolean;
      idempotencyKey: string;
    };
    expect(body.feedbackId).toBe('f_existing');
    expect(body.idempotent).toBe(true);
    expect(body.idempotencyKey).toBe('tenant-a\u0001r_1\u0001v_1\u0001user-a\u0001confirmed');
  });

  it('allows a different label for the same author/version (history preserved)', async () => {
    // First POST: confirmed.
    mocks.prismaFeedbackFindFirst.mockResolvedValue(null);
    let res = await callRoute('r_1', 'v_1', { label: 'confirmed' });
    expect(res.status).toBe(201);
    // Second POST: incorrect — distinct feedbackId, separate row.
    mocks.prismaFeedbackFindFirst.mockResolvedValue(null);
    res = await callRoute('r_1', 'v_1', { label: 'incorrect' });
    expect(res.status).toBe(201);
    expect(mocks.prismaFeedbackCreate).toHaveBeenCalledTimes(2);
  });

  it('recovers from a P2002 race by returning the existing row with idempotent: true', async () => {
    // Simulate two parallel POSTs: both pass the duplicate check, the
    // DB collapses the second via the @@unique, and we recover.
    const existing = {
      feedbackId: 'f_race',
      runId: 'r_1',
      versionId: 'v_1',
      label: 'confirmed',
      observations: null,
      realCause: null,
      resolutionEvidence: null,
      authorUserId: 'user-a',
      submittedAt: new Date('2026-09-07T09:00:00.000Z'),
    };
    // 1st call: no prior; 2nd call (after P2002): existing row.
    let calls = 0;
    mocks.prismaFeedbackFindFirst.mockImplementation(() => {
      calls += 1;
      return Promise.resolve(calls === 1 ? null : existing);
    });
    const { Prisma } = await import('@ftth-copilot/db');
    mocks.prismaFeedbackCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique violation', {
        code: 'P2002',
        clientVersion: '5.22.0',
      }),
    );

    const res = await callRoute('r_1', 'v_1', validBody);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { feedbackId: string; idempotent: boolean };
    expect(body.feedbackId).toBe('f_race');
    expect(body.idempotent).toBe(true);
  });
});
