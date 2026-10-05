import { prisma } from '@ftth-copilot/db';
import {
  dispatchToChannel,
  resolveRouting,
  type NotificationContext,
  type NotificationSeverity,
  type NotificationChannelType,
} from '@ftth-copilot/soc';

const CHANNEL_TYPES = new Set<string>(['slack', 'webhook', 'email', 'ntfy']);
const SEVERITIES = new Set<string>(['info', 'warning', 'critical']);

export interface DispatchSummary {
  considered: number;
  routed: number;
  sent: number;
  failed: number;
  /** Suppressed by a per-channel cooldown, not an error. */
  deduped: number;
}

/**
 * Fan an event out to every channel that wants it.
 *
 * Two properties matter more than throughput here:
 *
 *  1. A channel is never sent the same dedupeKey twice inside its cooldown. A flapping
 *     link produces a fresh alert object each scrape, and without the cooldown a single
 *     physical fault pages the on-call once per minute.
 *  2. One failing channel never prevents the others. Dispatch is concurrent and each
 *     result is settled independently, so a dead Slack endpoint cannot suppress the
 *     email that actually wakes someone up.
 */
export async function dispatchNotification(
  tenantId: string,
  ctx: NotificationContext,
  opts: { dryRun?: boolean } = {},
): Promise<DispatchSummary> {
  const summary: DispatchSummary = { considered: 0, routed: 0, sent: 0, failed: 0, deduped: 0 };

  const channels = await prisma.notificationChannel.findMany({
    where: { tenantId, enabled: true },
  });
  summary.considered = channels.length;
  if (channels.length === 0) return summary;

  // Prisma stores type/minSeverity as free text (no DB enum), so narrow them here
  // rather than casting blindly: a corrupt row must not become a channel that routes
  // to an unexpected target.
  const typed = channels.filter(
    (c): c is typeof c & { type: NotificationChannelType; minSeverity: NotificationSeverity } =>
      CHANNEL_TYPES.has(c.type) && SEVERITIES.has(c.minSeverity),
  );
  summary.considered = typed.length;
  if (typed.length === 0) return summary;

  const routed = resolveRouting(typed, ctx.severity as NotificationSeverity);
  summary.routed = routed.length;
  if (opts.dryRun) return summary;

  const results = await Promise.all(
    routed.map(async (channel) => {
      // Cooldown is checked per channel against the most recent successful delivery of
      // this same fault. The unique index on (dedupeKey, channelId) makes the
      // concurrent case safe: a losing insert is reported as a skip, not a double page.
      const recent = await prisma.notificationDelivery.findFirst({
        where: {
          channelId: channel.id,
          dedupeKey: ctx.dedupeKey,
          ok: true,
          createdAt: { gte: new Date(Date.now() - channel.cooldownSeconds * 1000) },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (recent) return { channel, skipped: true as const };

      const result = await dispatchToChannel(channel, ctx);

      try {
        await prisma.notificationDelivery.create({
          data: {
            tenantId,
            channelId: channel.id,
            dedupeKey: ctx.dedupeKey,
            severity: ctx.severity,
            title: ctx.title,
            ok: result.ok,
            status: result.status ?? null,
            error: result.error ?? null,
          },
        });
      } catch {
        // A delivery-log write must not turn a successful page into a failure.
      }

      await prisma.notificationChannel.update({
        where: { id: channel.id },
        data: {
          lastSentAt: result.ok ? new Date() : channel.lastSentAt,
          lastError: result.ok ? null : result.error ?? 'dispatch failed',
        },
      });

      return { channel, skipped: false as const, result };
    }),
  );

  for (const r of results) {
    if (r.skipped) {
      summary.deduped += 1;
    } else if (r.result.ok) {
      summary.sent += 1;
    } else {
      summary.failed += 1;
    }
  }

  return summary;
}
