import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@ftth-copilot/db';
import { getCurrentUser } from '@/lib/auth/server';
import { hasPermission } from '@/lib/auth/permissions';
import { redactSecrets, auditNotification, type NotificationChannel as Channel } from '@ftth-copilot/soc';
import { buildAuditContext } from '@/lib/audit-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SEVERITIES = ['info', 'warning', 'critical'] as const;
const TYPES = ['slack', 'webhook', 'email'] as const;

const createSchema = z.object({
  type: z.enum(TYPES),
  target: z.string().min(1).max(2000),
  enabled: z.boolean().default(true),
  minSeverity: z.enum(SEVERITIES).default('warning'),
  labels: z.array(z.string().max(64)).max(16).default([]),
  cooldownSeconds: z.number().int().min(0).max(86_400).default(300),
});

const updateSchema = createSchema.partial();

/** Shape returned to clients. The target is redacted: a webhook URL is a credential. */
function present(row: {
  id: string;
  type: string;
  target: string;
  enabled: boolean;
  minSeverity: string;
  labels: string[];
  cooldownSeconds: number;
  lastSentAt: Date | null;
  lastError: string | null;
  createdAt: Date;
}) {
  return {
    id: row.id,
    type: row.type,
    // Enough to identify the channel, not enough to post to it.
    target: redactSecrets(row.target),
    enabled: row.enabled,
    minSeverity: row.minSeverity,
    labels: row.labels,
    cooldownSeconds: row.cooldownSeconds,
    lastSentAt: row.lastSentAt?.toISOString() ?? null,
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function GET(): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 });
  if (!hasPermission(user.role, 'view_network')) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const [channels, recent] = await Promise.all([
    prisma.notificationChannel.findMany({ where: { tenantId: user.tenantId }, orderBy: { createdAt: 'asc' } }),
    prisma.notificationDelivery.findMany({
      where: { tenantId: user.tenantId },
      orderBy: { createdAt: 'desc' },
      take: 25,
      select: { channelId: true, ok: true, status: true, error: true, title: true, severity: true, createdAt: true },
    }),
  ]);

  return Response.json({
    channels: channels.map(present),
    recentDeliveries: recent.map((d) => ({
      ...d,
      error: d.error ? redactSecrets(d.error) : null,
      createdAt: d.createdAt.toISOString(),
    })),
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 });
  if (!hasPermission(user.role, 'manage_maintenance')) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: 'Invalid payload', detail: parsed.error.flatten() }, { status: 400 });
  }

  const data = parsed.data;
  // Fail fast on an unusable target rather than creating a channel that silently
  // swallows every alert.
  if (data.type !== 'email' && !/^https?:\/\//i.test(data.target)) {
    return Response.json({ error: 'target must be an http(s) URL for slack/webhook' }, { status: 400 });
  }
  if (data.type === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.target)) {
    return Response.json({ error: 'target must be an email address' }, { status: 400 });
  }

  const row = await prisma.notificationChannel.create({
    data: { ...data, tenantId: user.tenantId },
  });

  // Audit log
  await auditNotification.channelCreated(
    buildAuditContext(req as unknown as import('next/server').NextRequest, user),
    row.id,
    row.type,
  );

  return Response.json({ channel: present(row) }, { status: 201 });
}

export async function PATCH(req: NextRequest): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 });
  if (!hasPermission(user.role, 'manage_maintenance')) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const id = req.nextUrl.searchParams.get('id');
  if (!id) return Response.json({ error: 'id is required' }, { status: 400 });

  const parsed = updateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: 'Invalid payload', detail: parsed.error.flatten() }, { status: 400 });
  }

  const existing = await prisma.notificationChannel.findFirst({ where: { id, tenantId: user.tenantId } });
  if (!existing) return Response.json({ error: 'Not found' }, { status: 404 });

  const row = await prisma.notificationChannel.update({ where: { id }, data: parsed.data });

  // Audit log
  await auditNotification.channelUpdated(
    buildAuditContext(req as unknown as import('next/server').NextRequest, user),
    id,
  );

  return Response.json({ channel: present(row) });
}

export async function DELETE(req: NextRequest): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 });
  if (!hasPermission(user.role, 'manage_maintenance')) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const id = req.nextUrl.searchParams.get('id');
  if (!id) return Response.json({ error: 'id is required' }, { status: 400 });

  // Scoped by tenantId: a guessed id from another tenant must not be deletable.
  const deleted = await prisma.notificationChannel.deleteMany({ where: { id, tenantId: user.tenantId } });
  if (deleted.count === 0) return Response.json({ error: 'Not found' }, { status: 404 });

  // Audit log
  await auditNotification.channelDeleted(
    buildAuditContext(req as unknown as import('next/server').NextRequest, user),
    id,
  );

  return Response.json({ ok: true });
}

/**
 * POST /api/ops/notifications/test?id=<channelId>
 *
 * Dry-run a channel. Delivers a synthetic payload and reports the outcome without
 * writing a delivery row, so an operator can verify a webhook before trusting it with
 * real pages.
 */
export async function PUT(req: NextRequest): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 });
  if (!hasPermission(user.role, 'manage_maintenance')) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const id = req.nextUrl.searchParams.get('id');
  if (!id) return Response.json({ error: 'id is required' }, { status: 400 });

  const row = await prisma.notificationChannel.findFirst({ where: { id, tenantId: user.tenantId } });
  if (!row) return Response.json({ error: 'Not found' }, { status: 404 });

  // Validate the stored row before it can act as a channel. This checks that the
  // stored values are RECOGNISED, not whether the channel would route at some severity
  // — a channel with minSeverity 'critical' correctly declines 'info', so probing via
  // resolveRouting would report a perfectly good channel as broken.
  const knownTypes = new Set<string>(TYPES);
  const knownSeverities = new Set<string>(SEVERITIES);
  if (!knownTypes.has(row.type) || !knownSeverities.has(row.minSeverity)) {
    return Response.json({
      error: 'Channel is misconfigured: type or minSeverity is not a recognised value',
      stored: { type: row.type, minSeverity: row.minSeverity, enabled: row.enabled },
    }, { status: 422 });
  }
  if (!row.enabled) {
    return Response.json({ error: 'Channel is disabled; enable it before testing' }, { status: 409 });
  }

  const { dispatchToChannel } = await import('@ftth-copilot/soc');
  const result = await dispatchToChannel(
    { ...row, type: row.type as Channel['type'], minSeverity: row.minSeverity as 'info' | 'warning' | 'critical' },
    {
      title: 'Test notification from FTTH-Copilot',
      body: 'If you can read this, the channel is wired correctly.',
      severity: 'info',
      kind: 'test',
      deviceKind: 'OLT',
      deviceId: 'TEST-000',
      dedupeKey: `test-${Date.now()}`,
    },
  );

  return Response.json({ result });
}
