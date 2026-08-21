import { prisma } from '@ftth-copilot/db';

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function startOfMinute(now: Date): Date {
  return new Date(Math.floor(now.getTime() / 60_000) * 60_000);
}

function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

class QuotaExceededError extends Error {
  constructor(readonly retryAfter: number) {
    super('Chat quota exceeded');
  }
}

export async function consumeChatQuota(
  userId: string,
): Promise<{ allowed: boolean; retryAfter: number }> {
  const perMinute = positiveInt(process.env['CHAT_RATE_LIMIT_PER_MINUTE'], 10);
  const perDay = positiveInt(process.env['CHAT_DAILY_QUOTA'], 200);
  const now = new Date();
  const minuteStart = startOfMinute(now);
  const minuteEnd = new Date(minuteStart.getTime() + 60_000);
  const dayStart = startOfUtcDay(now);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60_000);

  try {
    await prisma.$transaction(async (tx) => {
      await tx.rateLimitBucket.deleteMany({ where: { expiresAt: { lt: now } } });

      const minute = await tx.rateLimitBucket.upsert({
        where: {
          userId_scope_windowStart: { userId, scope: 'chat:minute', windowStart: minuteStart },
        },
        create: {
          userId,
          scope: 'chat:minute',
          windowStart: minuteStart,
          expiresAt: minuteEnd,
          count: 1,
        },
        update: { count: { increment: 1 } },
      });
      if (minute.count > perMinute) {
        throw new QuotaExceededError(
          Math.max(1, Math.ceil((minuteEnd.getTime() - now.getTime()) / 1000)),
        );
      }

      const day = await tx.rateLimitBucket.upsert({
        where: {
          userId_scope_windowStart: { userId, scope: 'chat:day', windowStart: dayStart },
        },
        create: {
          userId,
          scope: 'chat:day',
          windowStart: dayStart,
          expiresAt: dayEnd,
          count: 1,
        },
        update: { count: { increment: 1 } },
      });
      if (day.count > perDay) {
        throw new QuotaExceededError(
          Math.max(1, Math.ceil((dayEnd.getTime() - now.getTime()) / 1000)),
        );
      }
    });
    return { allowed: true, retryAfter: 0 };
  } catch (error) {
    if (error instanceof QuotaExceededError) {
      return { allowed: false, retryAfter: error.retryAfter };
    }
    throw error;
  }
}
