import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '@/lib/auth/permissions';

/**
 * RED tests for the maintenance-window re-evaluation.
 *
 * The route re-evaluates the incidents that are still open when a window
 * ends, and notifies each one **once** per window. The "once" was enforced
 * by looking up the audit log for every incident in turn:
 *
 *     for (const inc of incidents) {
 *       await prisma.agentActionLog.findFirst({ ...json filters... });
 *     }
 *
 * Two problems, and they compound:
 *
 *   1. it is an N+1: one query per incident;
 *   2. the filter is on JSON paths (`parameters->>'windowId'` and
 *      `result->>'incidentId'`), which no btree index can serve, so each of
 *      those queries scanned the tenant's whole audit log. The audit log has
 *      no retention, so it grows forever: the route was quadratic in the
 *      size of the tenant's audit history.
 *
 * What is asserted:
 *   1. The dedupe lookup is ONE query for the whole window.
 *   2. The per-incident lookup (`findFirst`) is not used.
 *   3. An incident already notified in this window is skipped, and no row is
 *      written for it.
 *   4. An incident never notified is notified, exactly once.
 */

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  hasPermission: vi.fn(),
  windowFindUnique: vi.fn(),
  incidentFindMany: vi.fn(),
  logFindMany: vi.fn(),
  logFindFirst: vi.fn(),
  logCreate: vi.fn(),
}));

vi.mock('@/lib/auth/server', () => ({
  getCurrentUser: mocks.getCurrentUser,
}));

vi.mock('@/lib/auth/permissions', () => ({
  hasPermission: mocks.hasPermission,
}));

vi.mock('@ftth-copilot/db', () => ({
  prisma: {
    maintenanceWindow: { findUnique: mocks.windowFindUnique },
    incident: { findMany: mocks.incidentFindMany },
    agentActionLog: {
      findMany: mocks.logFindMany,
      findFirst: mocks.logFindFirst,
      create: mocks.logCreate,
    },
  },
}));

import { POST as reevaluate } from '@/app/api/maintenance-windows/[id]/reevaluate/route';

const fakeUser = {
  id: 'user-1',
  email: 'noc@isp.com',
  name: 'NOC',
  role: 'ADMIN' as Role,
  tenantId: 'tenant-1',
  tenant: { id: 'tenant-1', name: 'ISP', slug: 'isp' },
};

const WINDOW = {
  id: 'w1',
  tenantId: 'tenant-1',
  title: 'Mantenimiento',
  startUtc: new Date('2026-11-02T10:00:00.000Z'),
  endUtc: new Date('2026-11-02T11:00:00.000Z'),
  status: 'scheduled',
};

function incident(id: string): Record<string, unknown> {
  return { id, tenantId: 'tenant-1', status: 'open' };
}

beforeEach(() => {
  vi.stubEnv('MAINTENANCE_REEVAL_ENABLED', 'true');
  mocks.getCurrentUser.mockReset().mockResolvedValue(fakeUser);
  mocks.hasPermission.mockReset().mockReturnValue(true);
  mocks.windowFindUnique.mockReset().mockResolvedValue(WINDOW);
  mocks.incidentFindMany.mockReset().mockResolvedValue([]);
  mocks.logFindMany.mockReset().mockResolvedValue([]);
  mocks.logFindFirst.mockReset().mockResolvedValue(null);
  mocks.logCreate.mockReset().mockResolvedValue({});
});

describe('POST /api/maintenance-windows/:id/reevaluate — la deduplicación no es un N+1', () => {
  it('el aviso de "ya notificado" sale en una sola consulta', async () => {
    mocks.incidentFindMany.mockResolvedValue([incident('i1'), incident('i2'), incident('i3')]);

    const res = await reevaluate(
      new Request('http://localhost/api/maintenance-windows/w1/reevaluate', {
        method: 'POST',
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ id: 'w1' }) },
    );

    expect(res.status).toBe(200);
    expect(mocks.logFindMany).toHaveBeenCalledTimes(1);
    expect(mocks.logFindFirst).not.toHaveBeenCalled();
  });

  it('la consulta de dedupe filtra por la ventana', async () => {
    mocks.incidentFindMany.mockResolvedValue([incident('i1')]);

    await reevaluate(
      new Request('http://localhost/api/maintenance-windows/w1/reevaluate', {
        method: 'POST',
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ id: 'w1' }) },
    );

    const where = mocks.logFindMany.mock.calls[0]![0].where;
    expect(where.tenantId).toBe('tenant-1');
    expect(where.toolName).toBe('__maintenance_reeval__');
    expect(where.parameters).toEqual({ path: ['windowId'], equals: 'w1' });
  });

  it('un incidente ya notificado en esta ventana se saltea y no se escribe', async () => {
    mocks.incidentFindMany.mockResolvedValue([incident('i1'), incident('i2')]);
    // `i1` ya tiene su fila de dedupe en esta ventana.
    mocks.logFindMany.mockResolvedValue([{ result: { incidentId: 'i1' } }]);

    const res = await reevaluate(
      new Request('http://localhost/api/maintenance-windows/w1/reevaluate', {
        method: 'POST',
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ id: 'w1' }) },
    );
    const body = (await res.json()) as { notified: number; skipped: number; reevaluated: number };

    expect(body.reevaluated).toBe(2);
    expect(body.notified).toBe(1);
    expect(body.skipped).toBe(1);
    expect(mocks.logCreate).toHaveBeenCalledTimes(1);
    expect(mocks.logCreate.mock.calls[0]![0].data.result).toEqual({ incidentId: 'i2' });
  });

  it('una fila de dedupe sin incidentId no salta ningún incidente', async () => {
    mocks.incidentFindMany.mockResolvedValue([incident('i1')]);
    mocks.logFindMany.mockResolvedValue([{ result: null }, { result: { other: 'x' } }]);

    const res = await reevaluate(
      new Request('http://localhost/api/maintenance-windows/w1/reevaluate', {
        method: 'POST',
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ id: 'w1' }) },
    );
    const body = (await res.json()) as { notified: number; skipped: number };

    expect(body.notified).toBe(1);
    expect(body.skipped).toBe(0);
  });

  it('sin incidentes no consulta el log de dedupe', async () => {
    mocks.incidentFindMany.mockResolvedValue([]);

    const res = await reevaluate(
      new Request('http://localhost/api/maintenance-windows/w1/reevaluate', {
        method: 'POST',
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ id: 'w1' }) },
    );
    const body = (await res.json()) as { notified: number; skipped: number; reevaluated: number };

    expect(body.reevaluated).toBe(0);
    expect(body.notified).toBe(0);
    expect(mocks.logFindMany).not.toHaveBeenCalled();
  });
});
