import { decryptApiKey, issueToken, prisma, type Role } from '@ftth-copilot/db';
import { verifyTOTP } from '@/lib/auth/totp';

export interface MfaCandidateUser {
  id: string;
  tenantId: string;
  role: Role;
  mfaEnabled: boolean;
  totpSecret: string | null;
}

export type MfaGateResult =
  | { action: 'allow' }
  | { action: 'invalid_code' }
  | { action: 'mfa_required'; tempToken: string }
  | { action: 'mfa_setup_required'; tempToken: string };

/**
 * Check whether the given tenant requires MFA for all users.
 * Fails safe to `false` when no policy row exists.
 */
export async function isTenantMfaRequired(tenantId: string): Promise<boolean> {
  const policy = await prisma.tenantPolicy?.findUnique({
    where: { tenantId },
    select: { requireMfa: true },
  });
  return policy?.requireMfa === true;
}

/**
 * Evaluate whether a login attempt may proceed to a full session, requires
 * TOTP verification, or must enroll TOTP first due to tenant policy.
 */
export function evaluateMfaGate(
  user: MfaCandidateUser,
  tenantRequiresMfa: boolean,
  code?: string,
): MfaGateResult {
  if (user.mfaEnabled && user.totpSecret) {
    if (code) {
      const secret = decryptApiKey(user.totpSecret);
      return verifyTOTP(secret, code) ? { action: 'allow' } : { action: 'invalid_code' };
    }
    const { token: tempToken } = issueToken(user.id, user.tenantId, user.role, true);
    return { action: 'mfa_required', tempToken };
  }

  if (tenantRequiresMfa) {
    const { token: tempToken } = issueToken(user.id, user.tenantId, user.role, true);
    return { action: 'mfa_setup_required', tempToken };
  }

  return { action: 'allow' };
}
