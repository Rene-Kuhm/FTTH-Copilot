import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  deleteMany: vi.fn(),
  upsert: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('@ftth-copilot/db', () => ({
  prisma: {
    $transaction: mocks.transaction,
  },
}));

import { consumeInvestigationQuota } from '../src/quota';

const USER_ID = 'user-001';
const ORIGINAL_ENV = {
  perMinute: process.env['INVESTIGATION_RATE_LIMIT_PER_MINUTE'],
  perDay: process.env['INVESTIGATION_DAILY_QUOTA'],
};

function restoreEnv(): void {
  if (ORIGINAL_ENV.perMinute === undefined) {
    delete process.env['INVESTIGATION_RATE_LIMIT_PER_MINUTE'];
  } else {
    process.env['INVESTIGATION_RATE_LIMIT_PER_MINUTE'] = ORIGINAL_ENV.perMinute;
  }
  if (ORIGINAL_ENV.perDay === undefined) {
    delete process.env['INVESTIGATION_DAILY_QUOTA'];
  } else {
    process.env['INVESTIGATION_DAILY_QUOTA'] = ORIGINAL_ENV.perDay;
  }
}

describe('consumeInvestigationQuota', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-15T14:23:42.200Z'));
    vi.clearAllMocks();
    delete process.env['INVESTIGATION_RATE_LIMIT_PER_MINUTE'];
    delete process.env['INVESTIGATION_DAILY_QUOTA'];

    mocks.deleteMany.mockResolvedValue({ count: 0 });
    mocks.upsert.mockResolvedValue({ count: 1 });
    mocks.transaction.mockImplementation(
      async (callback: (tx: { rateLimitBucket: { deleteMany: typeof mocks.deleteMany; upsert: typeof mocks.upsert } }) => Promise<unknown>) =>
        callback({
          rateLimitBucket: {
            deleteMany: mocks.deleteMany,
            upsert: mocks.upsert,
          },
        }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    restoreEnv();
  });

  it('permite la solicitud cuando los contadores están dentro de los límites por minuto y diario', async () => {
    mocks.upsert
      .mockResolvedValueOnce({ count: 10 })
      .mockResolvedValueOnce({ count: 100 });

    const result = await consumeInvestigationQuota(USER_ID);

    expect(result).toEqual({ allowed: true, retryAfter: 0 });
  });

  it('limpia buckets expirados y realiza upsert con scope, windowStart, expiresAt e incremento correctos', async () => {
    const now = new Date('2026-10-15T14:23:42.200Z');
    const minuteStart = new Date('2026-10-15T14:23:00.000Z');
    const minuteEnd = new Date('2026-10-15T14:24:00.000Z');
    const dayStart = new Date('2026-10-15T00:00:00.000Z');
    const dayEnd = new Date('2026-10-16T00:00:00.000Z');

    await consumeInvestigationQuota(USER_ID);

    expect(mocks.deleteMany).toHaveBeenCalledTimes(1);
    expect(mocks.deleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lt: now } },
    });

    expect(mocks.upsert).toHaveBeenCalledTimes(2);
    expect(mocks.upsert).toHaveBeenNthCalledWith(1, {
      where: {
        userId_scope_windowStart: {
          userId: USER_ID,
          scope: 'investigation:minute',
          windowStart: minuteStart,
        },
      },
      create: {
        userId: USER_ID,
        scope: 'investigation:minute',
        windowStart: minuteStart,
        expiresAt: minuteEnd,
        count: 1,
      },
      update: { count: { increment: 1 } },
    });

    expect(mocks.upsert).toHaveBeenNthCalledWith(2, {
      where: {
        userId_scope_windowStart: {
          userId: USER_ID,
          scope: 'investigation:day',
          windowStart: dayStart,
        },
      },
      create: {
        userId: USER_ID,
        scope: 'investigation:day',
        windowStart: dayStart,
        expiresAt: dayEnd,
        count: 1,
      },
      update: { count: { increment: 1 } },
    });
  });

  it('rechaza con retryAfter positivo y consistente con la ventana al exceder el límite por minuto', async () => {
    // At 14:23:42.200Z, 17.8s remain until 14:24:00.000Z -> Math.ceil = 18s
    mocks.upsert.mockResolvedValueOnce({ count: 11 });

    const result = await consumeInvestigationQuota(USER_ID);

    expect(result).toEqual({ allowed: false, retryAfter: 18 });
    expect(result.retryAfter).toBeGreaterThan(0);
    // Short-circuits before updating daily bucket
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
  });

  it('garantiza retryAfter >= 1 cuando el exceso por minuto ocurre en el último milisegundo', async () => {
    vi.setSystemTime(new Date('2026-10-15T14:23:59.999Z'));
    mocks.upsert.mockResolvedValueOnce({ count: 11 });

    const result = await consumeInvestigationQuota(USER_ID);

    expect(result).toEqual({ allowed: false, retryAfter: 1 });
  });

  it('rechaza con retryAfter consistente con el fin del día UTC al exceder el límite diario', async () => {
    vi.setSystemTime(new Date('2026-10-15T23:59:10.000Z'));
    mocks.upsert
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 101 });

    const result = await consumeInvestigationQuota(USER_ID);

    expect(result).toEqual({ allowed: false, retryAfter: 50 });
  });

  it('respeta los overrides de INVESTIGATION_RATE_LIMIT_PER_MINUTE e INVESTIGATION_DAILY_QUOTA', async () => {
    process.env['INVESTIGATION_RATE_LIMIT_PER_MINUTE'] = '3';
    process.env['INVESTIGATION_DAILY_QUOTA'] = '5';

    // Within custom limits (3/min, 5/day)
    mocks.upsert
      .mockResolvedValueOnce({ count: 3 })
      .mockResolvedValueOnce({ count: 5 });
    expect(await consumeInvestigationQuota(USER_ID)).toEqual({ allowed: true, retryAfter: 0 });

    // Exceeds custom minute limit (4 > 3)
    mocks.upsert.mockResolvedValueOnce({ count: 4 });
    expect(await consumeInvestigationQuota(USER_ID)).toEqual({ allowed: false, retryAfter: 18 });

    // Within minute limit, exceeds custom daily limit (6 > 5)
    vi.setSystemTime(new Date('2026-10-15T23:59:30.000Z'));
    mocks.upsert
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 6 });
    expect(await consumeInvestigationQuota(USER_ID)).toEqual({ allowed: false, retryAfter: 30 });
  });

  it('usa los defaults (10/min, 100/día) cuando las variables de entorno son inválidas o no positivas', async () => {
    process.env['INVESTIGATION_RATE_LIMIT_PER_MINUTE'] = '0';
    process.env['INVESTIGATION_DAILY_QUOTA'] = '-5';

    mocks.upsert
      .mockResolvedValueOnce({ count: 10 })
      .mockResolvedValueOnce({ count: 100 });
    expect(await consumeInvestigationQuota(USER_ID)).toEqual({ allowed: true, retryAfter: 0 });

    process.env['INVESTIGATION_RATE_LIMIT_PER_MINUTE'] = 'not-a-number';
    process.env['INVESTIGATION_DAILY_QUOTA'] = '';

    mocks.upsert
      .mockResolvedValueOnce({ count: 10 })
      .mockResolvedValueOnce({ count: 101 });
    const dailyExceeded = await consumeInvestigationQuota(USER_ID);
    expect(dailyExceeded.allowed).toBe(false);
    expect(dailyExceeded.retryAfter).toBeGreaterThan(0);
  });

  it('propaga errores de base de datos distintos de InvestigationQuotaExceededError', async () => {
    mocks.transaction.mockRejectedValue(new Error('Transaction deadlock'));

    await expect(consumeInvestigationQuota(USER_ID)).rejects.toThrow('Transaction deadlock');
  });
});
