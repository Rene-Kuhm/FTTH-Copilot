import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * RED tests for `loadTenantPolicy` at
 * `apps/web/lib/policies/load-tenant-policy.ts` (WU6 / E-5.2).
 *
 * Contract under test:
 *   1. Present row → all 5 knobs forwarded (only those that are non-null)
 *   2. Absent row → null
 *   3. Prisma throws → null (chat route never breaks on a DB blip)
 *   4. abstainOnCodes as JSON string → decoded into the VerdictCode subset
 *   5. abstainOnCodes with unknown entries → unknown entries dropped
 */

const mocks = vi.hoisted(() => ({
  prismaTenantPolicyFindUnique: vi.fn(),
}));

vi.mock('@ftth-copilot/db', () => ({
  prisma: {
    tenantPolicy: {
      findUnique: mocks.prismaTenantPolicyFindUnique,
    },
  },
}));

const fixedRow = {
  tenantId: 'tenant-1',
  schemaVersion: 1,
  retrievalLimit: 7,
  retrievalSinceDays: 30,
  truthGateMode: 'observe' as 'observe' | 'strict',
  abstainOnCodes: JSON.stringify(['incomplete', 'stale']),
  promotionMinAgeMs: 60_000,
  lastEvaluatedAt: new Date('2026-09-01T12:00:00.000Z'),
  createdAt: new Date('2026-09-01T11:00:00.000Z'),
  updatedAt: new Date('2026-09-01T11:00:00.000Z'),
};

beforeEach(() => {
  mocks.prismaTenantPolicyFindUnique.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('loadTenantPolicy — row mapping', () => {
  it('returns null when the tenantId is empty (defensive guard)', async () => {
    const { loadTenantPolicy } = await import('@/lib/policies/load-tenant-policy');
    expect(await loadTenantPolicy('')).toBeNull();
    expect(mocks.prismaTenantPolicyFindUnique).not.toHaveBeenCalled();
  });

  it('returns null when no row exists', async () => {
    mocks.prismaTenantPolicyFindUnique.mockResolvedValue(null);
    const { loadTenantPolicy } = await import('@/lib/policies/load-tenant-policy');
    expect(await loadTenantPolicy('tenant-1')).toBeNull();
    expect(mocks.prismaTenantPolicyFindUnique).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1' },
    });
  });

  it('maps a fully-populated row onto the TenantPolicy envelope', async () => {
    mocks.prismaTenantPolicyFindUnique.mockResolvedValue(fixedRow);
    const { loadTenantPolicy } = await import('@/lib/policies/load-tenant-policy');
    const policy = await loadTenantPolicy('tenant-1');
    expect(policy).toEqual({
      schema: 'ftth.tenant-policy.v1',
      schemaVersion: 1,
      tenantId: 'tenant-1',
      retrievalLimit: 7,
      retrievalSinceDays: 30,
      truthGateMode: 'observe',
      abstainOnCodes: ['incomplete', 'stale'],
      promotionMinAgeMs: 60_000,
      lastEvaluatedAt: '2026-09-01T12:00:00.000Z',
      createdAt: '2026-09-01T11:00:00.000Z',
      updatedAt: '2026-09-01T11:00:00.000Z',
    });
  });

  it('omits nullable fields when the row leaves them null', async () => {
    mocks.prismaTenantPolicyFindUnique.mockResolvedValue({
      ...fixedRow,
      retrievalLimit: null,
      retrievalSinceDays: null,
      truthGateMode: null,
      abstainOnCodes: null,
      promotionMinAgeMs: null,
      lastEvaluatedAt: null,
    });
    const { loadTenantPolicy } = await import('@/lib/policies/load-tenant-policy');
    const policy = await loadTenantPolicy('tenant-1');
    expect(policy).toEqual({
      schema: 'ftth.tenant-policy.v1',
      schemaVersion: 1,
      tenantId: 'tenant-1',
      createdAt: '2026-09-01T11:00:00.000Z',
      updatedAt: '2026-09-01T11:00:00.000Z',
    });
  });

  it('returns null when the row schemaVersion is not 1', async () => {
    mocks.prismaTenantPolicyFindUnique.mockResolvedValue({ ...fixedRow, schemaVersion: 2 });
    const { loadTenantPolicy } = await import('@/lib/policies/load-tenant-policy');
    expect(await loadTenantPolicy('tenant-1')).toBeNull();
  });

  it('returns null and logs when prisma.findUnique throws', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      mocks.prismaTenantPolicyFindUnique.mockRejectedValue(new Error('DB down'));
      const { loadTenantPolicy } = await import('@/lib/policies/load-tenant-policy');
      expect(await loadTenantPolicy('tenant-1')).toBeNull();
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe('loadTenantPolicy — abstainOnCodes decoding', () => {
  it('decodes JSON-string abstainOnCodes into the VerdictCode subset', async () => {
    mocks.prismaTenantPolicyFindUnique.mockResolvedValue({
      ...fixedRow,
      abstainOnCodes: JSON.stringify(['stale', 'low_confidence']),
    });
    const { loadTenantPolicy } = await import('@/lib/policies/load-tenant-policy');
    const policy = await loadTenantPolicy('tenant-1');
    expect(policy?.abstainOnCodes).toEqual(['stale', 'low_confidence']);
  });

  it('drops unknown entries from abstainOnCodes (forward-compat)', async () => {
    mocks.prismaTenantPolicyFindUnique.mockResolvedValue({
      ...fixedRow,
      abstainOnCodes: JSON.stringify(['stale', 'future_code', 'incomplete']),
    });
    const { loadTenantPolicy } = await import('@/lib/policies/load-tenant-policy');
    const policy = await loadTenantPolicy('tenant-1');
    expect(policy?.abstainOnCodes).toEqual(['stale', 'incomplete']);
  });

  it('returns null when abstainOnCodes JSON is malformed', async () => {
    mocks.prismaTenantPolicyFindUnique.mockResolvedValue({
      ...fixedRow,
      abstainOnCodes: 'this is not JSON',
    });
    const { loadTenantPolicy } = await import('@/lib/policies/load-tenant-policy');
    expect(await loadTenantPolicy('tenant-1')).toBeNull();
  });

  it('returns null when abstainOnCodes is not an array', async () => {
    mocks.prismaTenantPolicyFindUnique.mockResolvedValue({
      ...fixedRow,
      abstainOnCodes: JSON.stringify({ not: 'an array' }),
    });
    const { loadTenantPolicy } = await import('@/lib/policies/load-tenant-policy');
    expect(await loadTenantPolicy('tenant-1')).toBeNull();
  });

  it('accepts abstainOnCodes as a plain array (defensive against Prisma JSON coercion)', async () => {
    mocks.prismaTenantPolicyFindUnique.mockResolvedValue({
      ...fixedRow,
      abstainOnCodes: ['stale'],
    });
    const { loadTenantPolicy } = await import('@/lib/policies/load-tenant-policy');
    const policy = await loadTenantPolicy('tenant-1');
    expect(policy?.abstainOnCodes).toEqual(['stale']);
  });
});