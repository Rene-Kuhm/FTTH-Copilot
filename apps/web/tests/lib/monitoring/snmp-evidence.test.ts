import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { RawSnmpEvidenceEnvelope, SnmpVarbindDetail } from '@ftth-copilot/monitoring';

/**
 * Retention and handling policy for SNMP trap evidence.
 *
 * Three decisions are under test, each of which is a data-protection choice
 * rather than a technical detail:
 *
 *   1. Non-identifying varbinds stay readable, identifying ones do not.
 *   2. Identifying values are encrypted at rest.
 *   3. Retention is 90 days, and both retention and tenant offboarding delete
 *      every row.
 */

const mocks = vi.hoisted(() => ({
  upsert: vi.fn(),
  deleteMany: vi.fn(),
  encrypt: vi.fn(),
  decrypt: vi.fn(),
}));

vi.mock('@ftth-copilot/db', () => ({
  prisma: {
    snmpEvidence: { upsert: mocks.upsert, deleteMany: mocks.deleteMany },
  },
  encryptApiKey: mocks.encrypt,
  decryptApiKey: mocks.decrypt,
}));

const {
  normalizeEvidence,
  retentionDeadline,
  storeEvidence,
  purgeExpiredEvidence,
  purgeTenantEvidence,
  readIdentifyingVars,
  EVIDENCE_RETENTION_DAYS,
} = await import('@/lib/monitoring/snmp-evidence');

function varbind(overrides: Partial<SnmpVarbindDetail> = {}): SnmpVarbindDetail {
  return {
    oid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.1.1.0',
    type: 'OCTET STRING',
    value: 'LOS',
    ...overrides,
  } as SnmpVarbindDetail;
}

function envelope(varbinds: SnmpVarbindDetail[]): RawSnmpEvidenceEnvelope {
  return {
    evidenceId: 'ev-1',
    receivedAt: '2026-10-06T10:00:00.000Z',
    senderIp: '10.0.0.9',
    senderPort: 162,
    snmpVersion: 'v2c',
    pduType: 'TrapV2',
    trapOid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.1',
    sysUpTime: 1000,
    eventTime: null,
    varbinds,
    credentialsRedacted: true,
    fingerprint: 'fp-1',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.upsert.mockResolvedValue({});
  mocks.deleteMany.mockResolvedValue({ count: 3 });
  mocks.encrypt.mockReturnValue({ encryptedKey: 'enc-blob' });
  mocks.decrypt.mockReturnValue('[]');
});

describe('normalisation', () => {
  it('keeps non-identifying varbinds readable', () => {
    const result = normalizeEvidence(envelope([varbind()]));

    expect(result.varbinds[0]).toEqual({
      oid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.1.1.0',
      type: 'OCTET STRING',
      value: 'LOS',
    });
    expect(result.identifyingVars).toEqual([]);
  });

  it('routes an ONU serial to the encrypted part', () => {
    const result = normalizeEvidence(
      envelope([varbind({ oid: '1.3.6.1.4.1.41112.1.5.1.2', value: 'HWTC12345678' })]),
    );

    expect(result.identifyingVars).toEqual([
      { oid: '1.3.6.1.4.1.41112.1.5.1.2', value: 'HWTC12345678' },
    ]);
    // The varbind stays visible so it is not silently dropped from the record.
    expect(result.varbinds[0].value).toBe('[redacted]');
  });

  it('routes a MAC address to the encrypted part', () => {
    const result = normalizeEvidence(
      envelope([varbind({ oid: '1.3.6.1.2.1.2.2.1.6', value: 'aa:bb:cc:dd:ee:ff' })]),
    );

    expect(result.identifyingVars).toHaveLength(1);
    expect(result.varbinds[0].value).toBe('[redacted]');
  });

  it('catches an identifier that arrives in an innocuous OID', () => {
    // The value pattern is what catches this, not the OID.
    const result = normalizeEvidence(
      envelope([varbind({ oid: '1.3.6.1.4.1.99999.1.1', value: 'ZZTE1234567890' })]),
    );

    expect(result.identifyingVars).toHaveLength(1);
  });

  it('keeps the syslog-style priority readable', () => {
    const result = normalizeEvidence(
      envelope([varbind({ oid: '1.3.6.1.2.1.1.3.0', value: 5 })]),
    );

    expect(result.varbinds[0].value).toBe(5);
  });

  it('never carries rawHex into storage', () => {
    const result = normalizeEvidence(
      envelope([varbind({ oid: '1.3.6.1.4.1.1.1', value: 'x', rawHex: 'deadbeef' })]),
    );

    // rawHex is the bulk of the payload and adds nothing over the value.
    expect(JSON.stringify(result)).not.toContain('deadbeef');
  });

  it('carries the trap metadata through', () => {
    const result = normalizeEvidence(envelope([]));

    expect(result.metadata).toMatchObject({
      evidenceId: 'ev-1',
      fingerprint: 'fp-1',
      senderIp: '10.0.0.9',
      trapOid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.1',
      sysUpTime: 1000,
    });
  });
});

describe('retention', () => {
  it('is 90 days from receipt', () => {
    expect(EVIDENCE_RETENTION_DAYS).toBe(90);
  });

  it('computes the deadline from the receipt instant', () => {
    const from = new Date('2026-01-01T00:00:00.000Z');
    expect(retentionDeadline(from).toISOString()).toBe('2026-04-01T00:00:00.000Z');
  });

  it('stamps the deadline on the stored row', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    storeEvidence('ten-1', envelope([]), now);

    expect(mocks.upsert.mock.calls[0][0].create.expiresAt.toISOString()).toBe(
      '2026-04-01T00:00:00.000Z',
    );
  });

  it('purges everything past its deadline and reports the count', async () => {
    const now = new Date('2026-10-06T00:00:00.000Z');

    expect(await purgeExpiredEvidence(now)).toBe(3);
    expect(mocks.deleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lte: now } },
    });
  });
});

describe('encryption at rest', () => {
  it('leaves the encrypted column null when nothing identifying was captured', async () => {
    await storeEvidence('ten-1', envelope([varbind()]));

    expect(mocks.encrypt).not.toHaveBeenCalled();
    expect(mocks.upsert.mock.calls[0][0].create.identifyingVarsEncrypted).toBeNull();
  });

  it('encrypts identifying varbinds before they reach the database', async () => {
    await storeEvidence(
      'ten-1',
      envelope([varbind({ oid: '1.3.6.1.4.1.41112.1.5.1.2', value: 'HWTC12345678' })]),
    );

    expect(mocks.encrypt).toHaveBeenCalledTimes(1);
    const persisted = mocks.upsert.mock.calls[0][0].create.identifyingVarsEncrypted;
    expect(persisted).toBe('enc-blob');
    // The plaintext must not appear anywhere in the persisted row.
    expect(JSON.stringify(mocks.upsert.mock.calls[0][0].create)).not.toContain(
      'HWTC12345678',
    );
  });

  it('reads them back through decryption', () => {
    mocks.decrypt.mockReturnValue(
      JSON.stringify([{ oid: '1.3.6.1.4.1.41112.1.5.1.2', value: 'HWTC12345678' }]),
    );

    expect(
      readIdentifyingVars({ identifyingVarsEncrypted: 'enc-blob' }),
    ).toEqual([{ oid: '1.3.6.1.4.1.41112.1.5.1.2', value: 'HWTC12345678' }]);
  });

  it('returns nothing when nothing was encrypted', () => {
    expect(readIdentifyingVars({ identifyingVarsEncrypted: null })).toEqual([]);
  });
});

describe('tenant offboarding', () => {
  it('deletes every evidence row for the tenant', async () => {
    expect(await purgeTenantEvidence('ten-1')).toBe(3);
    expect(mocks.deleteMany).toHaveBeenCalledWith({ where: { tenantId: 'ten-1' } });
  });

  it('is scoped to the one tenant', async () => {
    await purgeTenantEvidence('ten-other');

    expect(mocks.deleteMany.mock.calls[0][0].where.tenantId).toBe('ten-other');
  });
});

describe('idempotency', () => {
  it('upserts on tenant and evidence id so a redelivered trap is not an error', async () => {
    await storeEvidence('ten-1', envelope([]));

    expect(mocks.upsert.mock.calls[0][0].where).toEqual({
      tenantId_evidenceId: { tenantId: 'ten-1', evidenceId: 'ev-1' },
    });
  });
});