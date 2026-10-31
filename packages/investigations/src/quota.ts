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

export class InvestigationQuotaExceededError extends Error {
  constructor(readonly retryAfter: number) {
    super('Investigation quota exceeded');
  }
}

/**
 * Checks and consumes quota for cognitive investigation requests.
 * Tracks per-minute and per-day rate limits using rate_limit_buckets.
 */
export async function consumeInvestigationQuota(
  userId: string,
): Promise<{ allowed: boolean; retryAfter: number }> {
  const perMinute = positiveInt(process.env['INVESTIGATION_RATE_LIMIT_PER_MINUTE'], 10);
  const perDay = positiveInt(process.env['INVESTIGATION_DAILY_QUOTA'], 100);
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
          userId_scope_windowStart: { userId, scope: 'investigation:minute', windowStart: minuteStart },
        },
        create: {
          userId,
          scope: 'investigation:minute',
          windowStart: minuteStart,
          expiresAt: minuteEnd,
          count: 1,
        },
        update: { count: { increment: 1 } },
      });
      if (minute.count > perMinute) {
        throw new InvestigationQuotaExceededError(
          Math.max(1, Math.ceil((minuteEnd.getTime() - now.getTime()) / 1000)),
        );
      }

      const day = await tx.rateLimitBucket.upsert({
        where: {
          userId_scope_windowStart: { userId, scope: 'investigation:day', windowStart: dayStart },
        },
        create: {
          userId,
          scope: 'investigation:day',
          windowStart: dayStart,
          expiresAt: dayEnd,
          count: 1,
        },
        update: { count: { increment: 1 } },
      });
      if (day.count > perDay) {
        throw new InvestigationQuotaExceededError(
          Math.max(1, Math.ceil((dayEnd.getTime() - now.getTime()) / 1000)),
        );
      }
    });
    return { allowed: true, retryAfter: 0 };
  } catch (error) {
    if (error instanceof InvestigationQuotaExceededError) {
      return { allowed: false, retryAfter: error.retryAfter };
    }
    throw error;
  }
}
