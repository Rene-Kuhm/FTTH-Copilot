import { describe, expect, it, vi, beforeEach } from 'vitest';
import { join } from 'node:path';

/**
 * Concurrency guarantees around confirmed incidents.
 *
 * A NOC operator double-confirming an incident at the same moment as a
 * colleague is ordinary, not exotic. The confirm route and the promote loop
 * both decide "has this been confirmed?" by reading before writing, so without
 * a uniqueness rule they can both see nothing and both insert. The result is
 * the same incident counted twice in post-mortems, with two audit entries.
 *
 * The defence is two-layered and both layers are asserted here: the existence
 * check first, and the database constraint as the backstop for the case where
 * two requests pass the check simultaneously.
 */

const mocks = vi.hoisted(() => ({
  incidentFindFirst: vi.fn(),
  confirmedFindFirst: vi.fn(),
  confirmedCreate: vi.fn(),
  agentLogCreate: vi.fn(),
  pendingFindMany: vi.fn(),
  pendingUpdate: vi.fn(),
  incidentFindMany: vi.fn(),
  auditConfirmed: vi.fn(),
  feedbackFindFirst: vi.fn(),
}));

vi.mock('@ftth-copilot/db', () => ({
  prisma: {
    incident: { findFirst: mocks.incidentFindFirst, findMany: mocks.incidentFindMany },
    confirmedIncident: {
      findFirst: mocks.confirmedFindFirst,
      create: mocks.confirmedCreate,
    },
    agentActionLog: { create: mocks.agentLogCreate },
    pendingIncidentCandidate: {
      findMany: mocks.pendingFindMany,
      update: mocks.pendingUpdate,
    },
    investigationFeedback: { findFirst: mocks.feedbackFindFirst },
  },
  Prisma: {
    PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error {
      code: string;
      constructor(message: string, code: string) {
        super(message);
        this.code = code;
      }
    },
  },
}));

vi.mock('@/lib/auth/server', () => ({
  getCurrentUser: async () => ({
    id: 'usr-1',
    email: 'op@isp.example',
    role: 'OWNER',
    tenantId: 'ten-1',
  }),
}));

vi.mock('@ftth-copilot/soc', () => ({
  auditIncident: { confirmed: mocks.auditConfirmed },
}));

const { POST } = await import('@/app/api/incidents/[id]/confirm/route');

const RESOLVED_INCIDENT = {
  id: 'inc-1',
  tenantId: 'ten-1',
  deviceKind: 'OLT',
  deviceId: 'OLT-9',
  severity: 2,
  status: 'resolved',
  firstSeenAt: new Date('2026-10-01T00:00:00Z'),
  resolvedAt: new Date('2026-10-02T00:00:00Z'),
};

const BODY = {
  summary: 'Loss of signal on port 3',
  rootCause: 'Fiber cut during excavation',
  fix: 'Spliced the fiber, link stable',
};

function request(): Request {
  return new Request('http://localhost/api/incidents/inc-1/confirm', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'test' },
    body: JSON.stringify(BODY),
  });
}

/** Path to the repository root: vitest runs with cwd at apps/web. */
function repoPath(relative: string): string {
  return join(process.cwd(), '..', '..', relative);
}

/**
 * Build the unique-constraint violation the database raises on a duplicate.
 *
 * The mock class takes (message, code) while the real Prisma declaration takes
 * a params object, so the constructor is cast rather than changed: the routes
 * only ever read `.code` and use `instanceof`.
 */
async function uniqueViolation(): Promise<Error> {
  const { Prisma } = await import('@ftth-copilot/db');
  const Ctor = Prisma.PrismaClientKnownRequestError as unknown as new (
    message: string,
    code: string,
  ) => Error;
  return new Ctor(
    'Unique constraint failed on the fields: (`tenantId`,`sourceIncidentId`)',
    'P2002',
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.incidentFindFirst.mockResolvedValue(RESOLVED_INCIDENT);
  mocks.feedbackFindFirst.mockResolvedValue(null);
  mocks.confirmedFindFirst.mockResolvedValue(null);
  mocks.agentLogCreate.mockResolvedValue({});
  mocks.auditConfirmed.mockResolvedValue(undefined);
  mocks.confirmedCreate.mockResolvedValue({
    id: 'ci-1',
    tenantId: 'ten-1',
    sourceIncidentId: 'inc-1',
  });
});

describe('confirming an incident twice', () => {
  it('returns the stored row on the second sequential confirmation', async () => {
    const first = await POST(request(), {
      params: Promise.resolve({ id: 'inc-1' }),
    } as never);
    expect(first.status).toBe(201);

    // The winner is now visible to the existence check.
    mocks.confirmedFindFirst.mockResolvedValue({
      id: 'ci-1',
      tenantId: 'ten-1',
      sourceIncidentId: 'inc-1',
    });
    const second = await POST(request(), {
      params: Promise.resolve({ id: 'inc-1' }),
    } as never);

    expect(second.status).toBe(200);
    // No second row, no second audit entry.
    expect(mocks.confirmedCreate).toHaveBeenCalledTimes(1);
    expect(mocks.auditConfirmed).toHaveBeenCalledTimes(1);
  });

  it('collapses two confirmations that both pass the existence check', async () => {
    // The interleaving the check-then-act cannot see: both requests read
    // "nothing confirmed yet" before either writes.
    const winner = { id: 'ci-1', tenantId: 'ten-1', sourceIncidentId: 'inc-1' };
    // Both requests must read "nothing confirmed yet", and the retry after the
    // unique violation must find the winner's row.
    mocks.confirmedFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValue(winner);

    // Must be the mocked Prisma class: the route guards with `instanceof`, so a
    // plain Error would be rethrown and the test would pass for the wrong reason.
    mocks.confirmedCreate
      .mockResolvedValueOnce(winner)
      .mockRejectedValueOnce(await uniqueViolation());

    const first = await POST(request(), {
      params: Promise.resolve({ id: 'inc-1' }),
    } as never);
    const second = await POST(request(), {
      params: Promise.resolve({ id: 'inc-1' }),
    } as never);

    expect(first.status).toBe(201);
    // Losing the race returns the winner's row instead of failing the operator.
    expect(second.status).toBe(200);
    // And it must not log a second audit entry for the same incident.
    expect(mocks.auditConfirmed).toHaveBeenCalledTimes(1);
  });
});

describe('the constraint that backs the race', () => {
  it('exists on tenantId and sourceIncidentId', async () => {
    // Asserted against the real schema, not a mock: the mock would happily
    // accept a second row and hide a missing migration.
    const fs = await import('node:fs');
    const schema = fs.readFileSync(repoPath('packages/db/prisma/schema.prisma'), 'utf8');
    const model = schema.slice(schema.indexOf('model ConfirmedIncident'));
    const block = model.slice(0, model.indexOf('\n}'));

    expect(block).toContain('@@unique([tenantId, sourceIncidentId])');
  });

  it('has a migration that creates the unique index', async () => {
    const fs = await import('node:fs');
    const sql = fs.readFileSync(
      repoPath('packages/db/prisma/migrations/20261006120000_confirmed_incident_source_unique/migration.sql'),
      'utf8',
    );

    expect(sql).toContain('CREATE UNIQUE INDEX');
    expect(sql).toContain('"ConfirmedIncident_tenantId_sourceIncidentId_key"');
    // Duplicates from before the constraint are collapsed, not ignored.
    expect(sql).toMatch(/DELETE FROM "ConfirmedIncident"/);
  });

  it('keeps nullable sourceIncidentId rows unaffected', async () => {
    const fs = await import('node:fs');
    const sql = fs.readFileSync(
      repoPath('packages/db/prisma/migrations/20261006120000_confirmed_incident_source_unique/migration.sql'),
      'utf8',
    );
    // Postgres treats NULLs as distinct inside a unique index, so rows with no
    // source incident must be excluded from the duplicate cleanup.
    expect(sql).toContain('IS NOT NULL');
  });
});
/**
 * The promote loop was the worse case: it never checked whether a confirmed
 * incident already existed for the source, relying on the candidate status
 * update that happens afterwards. Two overlapping runs therefore both inserted.
 */
describe('promoting a pending candidate twice', () => {
  it('treats a unique violation as a successful promotion', async () => {
    // Field names match toCandidateShape exactly: runSessionId and
    // toolCallsJson, not runId / hasIncomplete.
    const candidate = {
      id: 'cand-1',
      tenantId: 'ten-1',
      sourceIncidentId: 'inc-1',
      runSessionId: 'run-1',
      summary: 'Degraded power budget',
      toolCallsJson: [],
      status: 'pending',
      proposedConfirmedAt: new Date('2026-10-02T00:00:00Z'),
    };

    mocks.pendingFindMany.mockResolvedValue([candidate]);
    mocks.incidentFindMany.mockResolvedValue([
      {
        id: 'inc-1',
        tenantId: 'ten-1',
        deviceKind: 'OLT',
        deviceId: 'OLT-9',
        severity: 3,
        status: 'resolved',
        firstSeenAt: new Date('2026-10-01T00:00:00Z'),
        resolvedAt: new Date('2026-10-02T00:00:00Z'),
      },
    ]);
    mocks.pendingUpdate.mockResolvedValue({});

    mocks.confirmedCreate.mockRejectedValueOnce(await uniqueViolation());

    const { promotePendingIncidents } = await import('@/lib/promote-pending-incidents');
    const result = await promotePendingIncidents(new Date('2026-10-06T00:00:00Z'), async () => new Map());

    // Losing the race must count as promoted, not throw and not double count.
    expect(result.promoted).toBe(1);
    expect(result.skipped).toBe(0);
  });

  it('does not swallow a failure that is not a unique violation', async () => {
    // Field names match toCandidateShape exactly: runSessionId and
    // toolCallsJson, not runId / hasIncomplete.
    const candidate = {
      id: 'cand-1',
      tenantId: 'ten-1',
      sourceIncidentId: 'inc-1',
      runSessionId: 'run-1',
      summary: 'Degraded power budget',
      toolCallsJson: [],
      status: 'pending',
      proposedConfirmedAt: new Date('2026-10-02T00:00:00Z'),
    };

    mocks.pendingFindMany.mockResolvedValue([candidate]);
    mocks.incidentFindMany.mockResolvedValue([
      {
        id: 'inc-1',
        tenantId: 'ten-1',
        deviceKind: 'OLT',
        deviceId: 'OLT-9',
        severity: 3,
        status: 'resolved',
        firstSeenAt: new Date('2026-10-01T00:00:00Z'),
        resolvedAt: new Date('2026-10-02T00:00:00Z'),
      },
    ]);

    mocks.confirmedCreate.mockRejectedValueOnce(new Error('connection refused'));

    const { promotePendingIncidents } = await import('@/lib/promote-pending-incidents');

    // A real outage must surface, not be mistaken for a duplicate.
    await expect(
      promotePendingIncidents(new Date('2026-10-06T00:00:00Z'), async () => new Map()),
    ).rejects.toThrow(/connection refused/);
  });
});
