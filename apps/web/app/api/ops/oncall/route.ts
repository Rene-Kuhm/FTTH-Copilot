/**
 * On-Call Scheduling API
 *
 * GET    /api/ops/oncall          - List schedules and current on-call
 * POST   /api/ops/oncall          - Create new schedule
 * GET    /api/ops/oncall/:id      - Get schedule details
 * PATCH  /api/ops/oncall/:id      - Update schedule
 * DELETE /api/ops/oncall/:id      - Delete schedule
 *
 * POST   /api/ops/oncall/:id/entries    - Add entry to schedule
 * DELETE /api/ops/oncall/:id/entries/:entryId - Remove entry
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@ftth-copilot/db';
import { getCurrentUser } from '@/lib/auth/server';
import { hasPermission } from '@/lib/auth/permissions';
import { enforceApiRateLimit } from '@/lib/rate-limit-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createScheduleSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  rotationType: z.enum(['weekly', 'daily', 'custom']).default('weekly'),
  startOfWeek: z.number().int().min(1).max(7).default(1),
  primaryUserId: z.string().optional(),
  backupUserId: z.string().optional(),
  escalationUserId: z.string().optional(),
  handoffTime: z.string().regex(/^\d{2}:\d{2}$/).default('09:00'),
  timezone: z.string().max(64).default('UTC'),
});

const updateScheduleSchema = createScheduleSchema.partial();

const createEntrySchema = z.object({
  userId: z.string().min(1),
  role: z.enum(['primary', 'backup', 'escalation']).default('primary'),
  startUtc: z.string().datetime(),
  endUtc: z.string().datetime(),
  notes: z.string().max(500).optional(),
});

/**
 * GET /api/ops/oncall - List schedules and current on-call
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  if (!hasPermission(user.role, 'view_network')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const url = new URL(req.url);
  const scheduleId = url.searchParams.get('scheduleId');

  if (scheduleId) {
    // Get specific schedule with entries
    const schedule = await prisma.onCallSchedule.findFirst({
      where: { id: scheduleId, tenantId: user.tenantId },
      include: {
        entries: {
          orderBy: { startUtc: 'asc' },
        },
      },
    });

    if (!schedule) {
      return NextResponse.json({ error: 'Schedule not found' }, { status: 404 });
    }

    return NextResponse.json({ schedule });
  }

  // List all schedules
  const schedules = await prisma.onCallSchedule.findMany({
    where: { tenantId: user.tenantId },
    orderBy: { createdAt: 'desc' },
  });

  // Find current on-call for each schedule.
  //
  // One query for the whole list, not one per schedule: the number of
  // schedules is tenant data and grows with the size of the NOC, so asking
  // per schedule made drawing one screen cost one query per schedule.
  //
  // The entries come back ordered by `startUtc desc`, so the first one of
  // each schedule is the current one — the same rule the old per-schedule
  // `orderBy` applied.
  const now = new Date();
  const currentEntries = schedules.length
    ? await prisma.onCallEntry.findMany({
        where: {
          scheduleId: { in: schedules.map((s) => s.id) },
          startUtc: { lte: now },
          endUtc: { gte: now },
        },
        orderBy: { startUtc: 'desc' },
      })
    : [];

  const currentBySchedule = new Map<string, (typeof currentEntries)[number]>();
  for (const entry of currentEntries) {
    if (!currentBySchedule.has(entry.scheduleId)) {
      currentBySchedule.set(entry.scheduleId, entry);
    }
  }

  const schedulesWithCurrent = schedules.map((schedule) => ({
    ...schedule,
    currentEntry: currentBySchedule.get(schedule.id) ?? null,
  }));

  return NextResponse.json({ schedules: schedulesWithCurrent });
}

/**
 * POST /api/ops/oncall - Create new schedule
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  const limited = await enforceApiRateLimit(req, user.tenantId);
  if (limited) return limited;
  if (!hasPermission(user.role, 'manage_maintenance')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = createScheduleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const schedule = await prisma.onCallSchedule.create({
    data: {
      tenantId: user.tenantId,
      ...parsed.data,
    },
  });

  return NextResponse.json({ schedule }, { status: 201 });
}

/**
 * PATCH /api/ops/oncall - Update schedule
 */
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  const limited = await enforceApiRateLimit(req, user.tenantId);
  if (limited) return limited;
  if (!hasPermission(user.role, 'manage_maintenance')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const url = new URL(req.url);
  const scheduleId = url.searchParams.get('id');
  if (!scheduleId) {
    return NextResponse.json({ error: 'Schedule ID required' }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const parsed = updateScheduleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // Verify ownership
  const existing = await prisma.onCallSchedule.findFirst({
    where: { id: scheduleId, tenantId: user.tenantId },
  });
  if (!existing) {
    return NextResponse.json({ error: 'Schedule not found' }, { status: 404 });
  }

  const schedule = await prisma.onCallSchedule.update({
    where: { id: scheduleId },
    data: parsed.data,
  });

  return NextResponse.json({ schedule });
}

/**
 * DELETE /api/ops/oncall - Delete schedule
 */
export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  const limited = await enforceApiRateLimit(req, user.tenantId);
  if (limited) return limited;
  if (!hasPermission(user.role, 'manage_maintenance')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const url = new URL(req.url);
  const scheduleId = url.searchParams.get('id');
  if (!scheduleId) {
    return NextResponse.json({ error: 'Schedule ID required' }, { status: 400 });
  }

  // Verify ownership and delete
  const deleted = await prisma.onCallSchedule.deleteMany({
    where: { id: scheduleId, tenantId: user.tenantId },
  });

  if (deleted.count === 0) {
    return NextResponse.json({ error: 'Schedule not found' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
