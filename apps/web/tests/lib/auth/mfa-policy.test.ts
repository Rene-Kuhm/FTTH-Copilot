import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  prisma: {
    tenantPolicy: { findUnique: vi.fn() },
  },
  decryptApiKey: vi.fn(),
  issueToken: vi.fn(),
  verifyTOTP: vi.fn(),
}));

vi.mock('@ftth-copilot/db', () => ({
  prisma: mocks.prisma,
  decryptApiKey: mocks.decryptApiKey,
  issueToken: mocks.issueToken,
}));

vi.mock('@/lib/auth/totp', () => ({
  verifyTOTP: mocks.verifyTOTP,
}));

const { isTenantMfaRequired, evaluateMfaGate } = await import('@/lib/auth/mfa-policy');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.issueToken.mockReturnValue({
    token: 'temp-jwt',
    tokenHash: 'hash',
    expiresAt: new Date(Date.now() + 300_000),
  });
});

describe('mfa-policy', () => {
  it('returns false when tenant policy row is missing', async () => {
    mocks.prisma.tenantPolicy.findUnique.mockResolvedValueOnce(null);
    await expect(isTenantMfaRequired('ten-1')).resolves.toBe(false);
  });

  it('returns true when tenant policy has requireMfa enabled', async () => {
    mocks.prisma.tenantPolicy.findUnique.mockResolvedValueOnce({ requireMfa: true });
    await expect(isTenantMfaRequired('ten-1')).resolves.toBe(true);
  });

  it('requires MFA setup when tenant mandates MFA and user has not enrolled', () => {
    const result = evaluateMfaGate(
      { id: 'u1', tenantId: 'ten-1', role: 'OPERATOR', mfaEnabled: false, totpSecret: null },
      true,
    );
    expect(result).toEqual({ action: 'mfa_setup_required', tempToken: 'temp-jwt' });
    expect(mocks.issueToken).toHaveBeenCalledWith('u1', 'ten-1', 'OPERATOR', true);
  });

  it('allows login when tenant does not mandate MFA and user has not enrolled', () => {
    const result = evaluateMfaGate(
      { id: 'u1', tenantId: 'ten-1', role: 'OPERATOR', mfaEnabled: false, totpSecret: null },
      false,
    );
    expect(result).toEqual({ action: 'allow' });
  });

  it('prompts for TOTP code when user has MFA enabled and no code is supplied', () => {
    const result = evaluateMfaGate(
      { id: 'u1', tenantId: 'ten-1', role: 'OWNER', mfaEnabled: true, totpSecret: 'enc' },
      false,
    );
    expect(result).toEqual({ action: 'mfa_required', tempToken: 'temp-jwt' });
  });

  it('validates TOTP code when user has MFA enabled and code is supplied', () => {
    mocks.decryptApiKey.mockReturnValue('JBSWY3DPEHPK3PXP');
    mocks.verifyTOTP.mockReturnValueOnce(true).mockReturnValueOnce(false);

    expect(
      evaluateMfaGate(
        { id: 'u1', tenantId: 'ten-1', role: 'OWNER', mfaEnabled: true, totpSecret: 'enc' },
        true,
        '123456',
      ),
    ).toEqual({ action: 'allow' });

    expect(
      evaluateMfaGate(
        { id: 'u1', tenantId: 'ten-1', role: 'OWNER', mfaEnabled: true, totpSecret: 'enc' },
        true,
        '000000',
      ),
    ).toEqual({ action: 'invalid_code' });
  });
});
