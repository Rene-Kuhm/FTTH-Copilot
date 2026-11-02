import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { Role } from '@/lib/auth/permissions';

/**
 * RED tests for the on-call listing.
 *
 * The contract under test is not the shape of the response but **how many
 * queries it takes**: the route used to ask for the current entry of every
 * schedule in its own query, so the list cost one query per schedule.
 *
 * The schedule count is tenant data and grows with the size of the NOC, so
 * this is a real N+1: 50 schedules meant 51 queries to draw one screen.
 *
 * What is asserted:
 *   1. The current entries come in ONE query, whatever the number of
 *      schedules.
 *   2. The per-schedule query (`findFirst`) is not used at all.
 *   3. Each schedule keeps its own current entry, and the one with the
 *      LATEST `startUtc` wins (same rule as the old `orderBy`).
 *   4. A schedule with no entry in progress has `currentEntry: null`.
 */

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  hasPermission: vi.fn(),
  scheduleFindMany: vi.fn(),
  scheduleFindFirst: vi.fn(),
  entryFindMany: vi.fn(),
  entryFindFirst: vi.fn(),
}));

vi.mock('@/lib/auth/server', () => ({
  getCurrentUser: mocks.getCurrentUser,
}));

vi.mock('@/lib/auth/permissions', () => ({
  hasPermission: mocks.hasPermission,
}));

vi.mock('@ftth-copilot/db', () => ({
  prisma: {
    onCallSchedule: {
      findMany: mocks.scheduleFindMany,
      findFirst: mocks.scheduleFindFirst,
    },
    onCallEntry: {
      findMany: mocks.entryFindMany,
      findFirst: mocks.entryFindFirst,
    },
  },
}));

import { GET as listOnCall } from '@/app/api/ops/oncall/route';

const fakeUser = {
  id: 'user-1',
  email: 'noc@isp.com',
  name: 'NOC',
  role: 'ADMIN' as Role,
  tenantId: 'tenant-1',
  tenant: { id: 'tenant-1', name: 'ISP', slug: 'isp' },
};

const NOW = new Date('2026-11-02T12:00:00.000Z');

function schedule(id: string): Record<string, unknown> {
  return { id, tenantId: 'tenant-1', name: `schedule-${id}` };
}

function entry(id: string, scheduleId: string, startUtc: string): Record<string, unknown> {
  return { id, scheduleId, userId: 'user-9', startUtc: new Date(startUtc), endUtc: NOW };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  mocks.getCurrentUser.mockReset().mockResolvedValue(fakeUser);
  mocks.hasPermission.mockReset().mockReturnValue(true);
  mocks.scheduleFindMany.mockReset().mockResolvedValue([]);
  mocks.scheduleFindFirst.mockReset().mockResolvedValue(null);
  mocks.entryFindMany.mockReset().mockResolvedValue([]);
  mocks.entryFindFirst.mockReset().mockResolvedValue(null);
});

describe('GET /api/ops/oncall — la lista no es un N+1', () => {
  it('trae las entradas actuales en una sola consulta, no una por horario', async () => {
    mocks.scheduleFindMany.mockResolvedValue([schedule('s1'), schedule('s2'), schedule('s3')]);
    mocks.entryFindMany.mockResolvedValue([
      entry('e1', 's1', '2026-11-02T09:00:00.000Z'),
      entry('e2', 's2', '2026-11-02T10:00:00.000Z'),
    ]);

    const res = await listOnCall(new NextRequest('http://localhost/api/ops/oncall'));

    expect(res.status).toBe(200);
    expect(mocks.entryFindMany).toHaveBeenCalledTimes(1);
    expect(mocks.entryFindFirst).not.toHaveBeenCalled();
  });

  it('la consulta de entradas cubre los horarios pedidos', async () => {
    mocks.scheduleFindMany.mockResolvedValue([schedule('s1'), schedule('s2')]);

    await listOnCall(new NextRequest('http://localhost/api/ops/oncall'));

    const where = mocks.entryFindMany.mock.calls[0]![0].where;
    expect(where.scheduleId).toEqual({ in: ['s1', 's2'] });
    expect(where.startUtc).toEqual({ lte: NOW });
    expect(where.endUtc).toEqual({ gte: NOW });
  });

  it('cada horario se lleva su entrada actual, y gana la que empieza más tarde', async () => {
    mocks.scheduleFindMany.mockResolvedValue([schedule('s1'), schedule('s2')]);
    mocks.entryFindMany.mockResolvedValue([
      // Ordenadas por startUtc descendente, como las pedía el `orderBy` viejo.
      entry('e2', 's1', '2026-11-02T11:00:00.000Z'),
      entry('e1', 's1', '2026-11-02T09:00:00.000Z'),
      entry('e3', 's2', '2026-11-02T08:00:00.000Z'),
    ]);

    const res = await listOnCall(new NextRequest('http://localhost/api/ops/oncall'));
    const body = (await res.json()) as { schedules: Array<{ id: string; currentEntry: { id: string } | null }> };

    const byId = new Map(body.schedules.map((s) => [s.id, s.currentEntry]));
    expect(byId.get('s1')?.id).toBe('e2');
    expect(byId.get('s2')?.id).toBe('e3');
  });

  it('un horario sin nadie en turno tiene currentEntry null', async () => {
    mocks.scheduleFindMany.mockResolvedValue([schedule('s1'), schedule('s2')]);
    mocks.entryFindMany.mockResolvedValue([entry('e1', 's1', '2026-11-02T09:00:00.000Z')]);

    const res = await listOnCall(new NextRequest('http://localhost/api/ops/oncall'));
    const body = (await res.json()) as { schedules: Array<{ id: string; currentEntry: { id: string } | null }> };

    const byId = new Map(body.schedules.map((s) => [s.id, s.currentEntry]));
    expect(byId.get('s1')?.id).toBe('e1');
    expect(byId.get('s2')).toBeNull();
  });

  it('sin horarios no consulta las entradas', async () => {
    mocks.scheduleFindMany.mockResolvedValue([]);

    const res = await listOnCall(new NextRequest('http://localhost/api/ops/oncall'));

    expect(res.status).toBe(200);
    expect(mocks.entryFindMany).not.toHaveBeenCalled();
  });
});
